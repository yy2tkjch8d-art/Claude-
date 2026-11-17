'use strict';
/*
 * POST /api/checkout
 * Creates a Stripe Checkout session for a ticket order and returns its URL.
 * Prices and stock rules come from public/config.js, never from the browser.
 * Needs the STRIPE_SECRET_KEY environment variable in Netlify.
 */
const config = require('../../public/config.js');

const STRIPE_SESSIONS = 'https://api.stripe.com/v1/checkout/sessions';
const MAX_LINES = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

const dubaiTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dubai'
});
function when(iso) {
  const p = {};
  dubaiTime.formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; });
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

function validateOrder(input, catalog, now) {
  const fail = (error) => ({ ok: false, error });
  if (!input || typeof input !== 'object') return fail('Send the order as JSON.');

  const ev = (catalog.events || []).find((e) => e.id === input.eventId);
  if (!ev) return fail('That night does not exist.');
  if (ev.ticketUrl) return fail(`Tickets for this night are sold on ${ev.ticketSiteName || 'our ticketing partner'}.`);
  if (ev.status === 'sold-out') return fail('This night is sold out.');
  if (Date.parse(ev.end || ev.start) <= now) return fail('This night has already happened.');

  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) return fail('Your order is empty.');
  if (items.length > MAX_LINES) return fail('Too many lines in one order.');

  const maxTotal = (catalog.payments && catalog.payments.maxTicketsPerOrder) || 20;
  const seen = new Set();
  const lines = [];
  let count = 0;
  for (const item of items) {
    const tier = ev.tiers.find((t) => t.id === (item && item.tierId));
    if (!tier) return fail('One of those ticket types does not exist.');
    if (seen.has(tier.id)) return fail('Each ticket type can only appear once per order.');
    seen.add(tier.id);
    if (tier.soldOut) return fail(`${tier.name} is sold out.`);
    const max = Math.min(tier.maxPerOrder || 10, maxTotal);
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > max) {
      return fail(`You can buy between 1 and ${max} × ${tier.name} per order.`);
    }
    count += item.qty;
    lines.push({ tier, qty: item.qty });
  }
  if (count > maxTotal) return fail(`The most you can buy in one order is ${maxTotal}.`);

  const c = input.customer || {};
  const name = clean(c.name, 80);
  const email = clean(c.email, 254);
  const phone = clean(c.phone, 20);
  if (name.length < 2) return fail('Enter your full name as it appears on your ID.');
  if (!EMAIL.test(email)) return fail('Enter a valid email. Your ticket goes there.');
  if (!PHONE.test(phone)) return fail('Enter your WhatsApp number with the country code.');

  const consents = input.consents || {};
  if (consents.age !== true) return fail(`You need to be ${catalog.minAge || 21} or older to attend.`);
  if (consents.terms !== true) return fail('Accept the terms and refund policy to continue.');

  const total = lines.reduce((sum, l) => sum + l.tier.price * l.qty, 0);
  return { ok: true, order: { event: ev, lines, total, customer: { name, email, phone } } };
}

function buildSessionParams(order, siteUrl, currency) {
  const ev = order.event;
  const label = `EXP.${ev.number} ${ev.title}`;
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('submit_type', 'book');
  p.set('success_url', `${siteUrl}/success.html?event=${encodeURIComponent(ev.id)}&session_id={CHECKOUT_SESSION_ID}`);
  p.set('cancel_url', `${siteUrl}/?cancelled=1#tickets`);
  p.set('customer_email', order.customer.email);
  p.set('client_reference_id', ev.id);
  p.set('allow_promotion_codes', 'true');

  const meta = { event_id: ev.id, event: label, guest_name: order.customer.name, phone: order.customer.phone };
  Object.keys(meta).forEach((k) => {
    p.set(`metadata[${k}]`, meta[k]);
    p.set(`payment_intent_data[metadata][${k}]`, meta[k]);
  });
  p.set('payment_intent_data[description]', `ProjectX ${label}: ${order.lines.map((l) => `${l.qty} × ${l.tier.name}`).join(', ')}`);

  order.lines.forEach((l, i) => {
    p.set(`line_items[${i}][quantity]`, String(l.qty));
    p.set(`line_items[${i}][price_data][currency]`, String(currency).toLowerCase());
    // Stripe takes AED in fils: AED 200 is 20000.
    p.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(l.tier.price * 100)));
    p.set(`line_items[${i}][price_data][product_data][name]`, `${label} · ${l.tier.name}`);
    p.set(`line_items[${i}][price_data][product_data][description]`, `${when(ev.start)} · ${ev.area}`);
  });
  return p;
}

function siteOrigin(event, env) {
  if (env.URL) return String(env.URL).replace(/\/+$/, '');
  const host = event.headers && (event.headers.host || event.headers.Host);
  return host ? `https://${host}` : '';
}

async function handle(event, deps) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Use POST.' });

  const key = deps.env.STRIPE_SECRET_KEY;
  if (!key) return reply(503, { error: 'Card payments are not switched on yet.', code: 'not_configured' });

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (raw.length > 10000) return reply(413, { error: 'That order is too large.' });
  let input;
  try { input = JSON.parse(raw); } catch (e) { return reply(400, { error: 'Send the order as JSON.' }); }

  const result = validateOrder(input, deps.catalog, deps.now());
  if (!result.ok) return reply(400, { error: result.error });

  const siteUrl = siteOrigin(event, deps.env);
  if (!siteUrl) return reply(500, { error: 'The site address is not set.' });
  const currency = (deps.catalog.payments && deps.catalog.payments.currency) || 'AED';
  const params = buildSessionParams(result.order, siteUrl, currency);

  let res;
  let data;
  try {
    res = await deps.fetch(STRIPE_SESSIONS, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    data = await res.json();
  } catch (err) {
    console.error('Stripe request failed:', err && err.message);
    return reply(502, { error: 'The payment provider did not answer. Try again in a minute.' });
  }
  if (!res.ok || !data || !data.url) {
    console.error('Stripe error:', res.status, data && data.error && data.error.message);
    return reply(502, { error: 'The payment page could not be created. Try again in a minute.' });
  }
  return reply(200, { url: data.url });
}

exports.handler = (event) => handle(event, {
  env: process.env,
  now: () => Date.now(),
  fetch: (url, init) => fetch(url, init),
  catalog: config
});
exports.handle = handle;
exports.validateOrder = validateOrder;
exports.buildSessionParams = buildSessionParams;
