'use strict';
/*
 * GET /api/session?id=cs_...
 * Tells the confirmation page whether Stripe marked a Checkout session as paid,
 * and what was bought. Returns no personal details.
 */
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/;

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

async function handle(event, deps) {
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Use GET.' });
  const key = deps.env.STRIPE_SECRET_KEY;
  if (!key) return reply(503, { error: 'Card payments are not switched on yet.' });

  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!SESSION_ID.test(id)) return reply(400, { error: 'Unknown order.' });

  let res;
  let data;
  try {
    const query = new URLSearchParams({ 'expand[]': 'line_items' });
    res = await deps.fetch(`https://api.stripe.com/v1/checkout/sessions/${id}?${query}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    data = await res.json();
  } catch (err) {
    console.error('Stripe request failed:', err && err.message);
    return reply(502, { error: 'Could not check the order right now.' });
  }
  if (res.status === 404) return reply(404, { error: 'Unknown order.' });
  if (!res.ok || !data) return reply(502, { error: 'Could not check the order right now.' });

  const items = ((data.line_items && data.line_items.data) || []).map((li) => ({ name: li.description, qty: li.quantity }));
  return reply(200, {
    paid: data.payment_status === 'paid',
    status: data.payment_status || 'unknown',
    eventId: (data.metadata && data.metadata.event_id) || data.client_reference_id || '',
    total: typeof data.amount_total === 'number' ? data.amount_total / 100 : null,
    currency: String(data.currency || '').toUpperCase(),
    items
  });
}

exports.handler = (event) => handle(event, {
  env: process.env,
  fetch: (url, init) => fetch(url, init)
});
exports.handle = handle;
