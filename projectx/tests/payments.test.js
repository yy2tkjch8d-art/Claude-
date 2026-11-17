'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const checkout = require('../netlify/functions/checkout.js');
const session = require('../netlify/functions/session.js');

// A fixed catalog so these tests don't depend on the real dates in config.js.
const catalog = {
  minAge: 21,
  payments: { currency: 'AED', maxTicketsPerOrder: 20 },
  events: [
    {
      id: 'exp01', number: '01', title: 'Test Night',
      start: '2030-01-10T21:00:00+04:00', end: '2030-01-11T03:00:00+04:00',
      area: 'Rooftop · Dubai Marina', status: 'on-sale', ticketUrl: '',
      tiers: [
        { id: 'early', name: 'Early Bird', price: 150, soldOut: true },
        { id: 'ga', name: 'General', price: 200 },
        { id: 'vip', name: 'VIP', price: 450 },
        { id: 'table', name: 'VIP Table', price: 5000, maxPerOrder: 1 }
      ]
    },
    {
      id: 'past', number: '00', title: 'Old Night',
      start: '2020-01-10T21:00:00+04:00', end: '2020-01-11T03:00:00+04:00',
      area: 'Desert', status: 'on-sale', tiers: [{ id: 'ga', name: 'General', price: 100 }]
    },
    {
      id: 'ext', number: '02', title: 'Partner Night',
      start: '2030-02-10T21:00:00+04:00', end: '2030-02-11T03:00:00+04:00',
      area: 'Beach', status: 'on-sale', ticketUrl: 'https://tickets.example/night', ticketSiteName: 'Example Tickets',
      tiers: [{ id: 'ga', name: 'General', price: 100 }]
    }
  ]
};
const NOW = Date.parse('2029-12-01T12:00:00Z');

function order(overrides) {
  return Object.assign({
    eventId: 'exp01',
    items: [{ tierId: 'ga', qty: 2 }, { tierId: 'vip', qty: 1 }],
    customer: { name: 'Sara Test', email: 'sara@example.com', phone: '+971 50 123 4567' },
    consents: { age: true, terms: true }
  }, overrides);
}
function request(body, method) {
  return { httpMethod: method || 'POST', headers: { host: 'px.example' }, body: JSON.stringify(body), isBase64Encoded: false };
}
function stubFetch(response, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: response.status < 400, status: response.status, json: async () => response.body };
  };
}
function deps(fetchImpl, env) {
  return { env: env || { STRIPE_SECRET_KEY: 'sk_test_123', URL: 'https://px.example' }, now: () => NOW, fetch: fetchImpl, catalog };
}

test('a normal order is priced from the catalog, not the browser', () => {
  const r = checkout.validateOrder(order({ items: [{ tierId: 'ga', qty: 2, price: 1 }] }), catalog, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.order.total, 400);
});

test('orders that break the rules are refused', () => {
  const cases = [
    [order({ eventId: 'nope' }), /does not exist/],
    [order({ items: [] }), /empty/],
    [order({ items: [{ tierId: 'free', qty: 1 }] }), /does not exist/],
    [order({ items: [{ tierId: 'early', qty: 1 }] }), /sold out/],
    [order({ items: [{ tierId: 'ga', qty: 0 }] }), /between 1 and/],
    [order({ items: [{ tierId: 'ga', qty: 2.5 }] }), /between 1 and/],
    [order({ items: [{ tierId: 'ga', qty: '2' }] }), /between 1 and/],
    [order({ items: [{ tierId: 'table', qty: 2 }] }), /between 1 and 1/],
    [order({ items: [{ tierId: 'ga', qty: 1 }, { tierId: 'ga', qty: 1 }] }), /only appear once/],
    [order({ items: [{ tierId: 'ga', qty: 10 }, { tierId: 'vip', qty: 10 }, { tierId: 'table', qty: 1 }] }), /most you can buy/],
    [order({ eventId: 'past', items: [{ tierId: 'ga', qty: 1 }] }), /already happened/],
    [order({ eventId: 'ext', items: [{ tierId: 'ga', qty: 1 }] }), /Example Tickets/],
    [order({ customer: { name: 'S', email: 'sara@example.com', phone: '+971501234567' } }), /full name/],
    [order({ customer: { name: 'Sara', email: 'not-an-email', phone: '+971501234567' } }), /valid email/],
    [order({ customer: { name: 'Sara', email: 'sara@example.com', phone: 'call me' } }), /WhatsApp/],
    [order({ consents: { age: false, terms: true } }), /21 or older/],
    [order({ consents: { age: true } }), /terms/]
  ];
  for (const [input, message] of cases) {
    const r = checkout.validateOrder(input, catalog, NOW);
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(input.items)}`);
    assert.match(r.error, message);
  }
});

test('Stripe parameters carry AED amounts in fils and the event on the payment', () => {
  const r = checkout.validateOrder(order(), catalog, NOW);
  const p = checkout.buildSessionParams(r.order, 'https://px.example', 'AED');
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'aed');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '20000');
  assert.equal(p.get('line_items[0][quantity]'), '2');
  assert.equal(p.get('line_items[1][price_data][unit_amount]'), '45000');
  assert.equal(p.get('line_items[0][price_data][product_data][name]'), 'EXP.01 Test Night · General');
  assert.match(p.get('line_items[0][price_data][product_data][description]'), /^Thu 10 Jan 2030, 21:00 · Rooftop/);
  assert.equal(p.get('success_url'), 'https://px.example/success.html?event=exp01&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(p.get('payment_intent_data[metadata][guest_name]'), 'Sara Test');
  assert.equal(p.get('customer_email'), 'sara@example.com');
});

test('handler refuses anything but POST', async () => {
  const res = await checkout.handle(request(order(), 'GET'), deps(stubFetch({ status: 200, body: {} }, [])));
  assert.equal(res.statusCode, 405);
});

test('handler reports when payments are not configured', async () => {
  const res = await checkout.handle(request(order()), deps(stubFetch({ status: 200, body: {} }, []), {}));
  assert.equal(res.statusCode, 503);
});

test('handler rejects broken JSON and bad orders before calling Stripe', async () => {
  const calls = [];
  const bad = await checkout.handle({ httpMethod: 'POST', headers: {}, body: '{oops' }, deps(stubFetch({ status: 200, body: {} }, calls)));
  assert.equal(bad.statusCode, 400);
  const sold = await checkout.handle(request(order({ items: [{ tierId: 'early', qty: 1 }] })), deps(stubFetch({ status: 200, body: {} }, calls)));
  assert.equal(sold.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('handler creates a Stripe session and returns its URL', async () => {
  const calls = [];
  const res = await checkout.handle(request(order()), deps(stubFetch({ status: 200, body: { id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' } }, calls)));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).url, 'https://checkout.stripe.com/c/pay/cs_test_abc');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk_test_123');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(sent.get('line_items[1][price_data][unit_amount]'), '45000');
});

test('handler hides Stripe errors from the visitor', async () => {
  const res = await checkout.handle(request(order()), deps(stubFetch({ status: 401, body: { error: { message: 'Invalid API Key provided: sk_test_***' } } }, [])));
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(res.body, /sk_test/);
});

test('session lookup returns payment status and items only', async () => {
  const calls = [];
  const body = {
    payment_status: 'paid', amount_total: 85000, currency: 'aed', client_reference_id: 'exp01',
    metadata: { event_id: 'exp01', guest_name: 'Sara Test', phone: '+971501234567' },
    customer_details: { email: 'sara@example.com' },
    line_items: { data: [{ description: 'EXP.01 Test Night · General', quantity: 2 }] }
  };
  const id = 'cs_test_a1B2c3D4e5F6g7';
  const res = await session.handle({ httpMethod: 'GET', queryStringParameters: { id } }, { env: { STRIPE_SECRET_KEY: 'sk_test_123' }, fetch: stubFetch({ status: 200, body }, calls) });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.deepEqual(data, { paid: true, status: 'paid', eventId: 'exp01', total: 850, currency: 'AED', items: [{ name: 'EXP.01 Test Night · General', qty: 2 }] });
  assert.match(calls[0].url, /checkout\/sessions\/cs_test_a1B2c3D4e5F6g7\?expand%5B%5D=line_items$/);
  assert.doesNotMatch(res.body, /sara@example.com|\+971/);
});

test('session lookup rejects ids that are not Stripe session ids', async () => {
  const res = await session.handle({ httpMethod: 'GET', queryStringParameters: { id: '../../v1/charges' } }, { env: { STRIPE_SECRET_KEY: 'sk_test_123' }, fetch: stubFetch({ status: 200, body: {} }, []) });
  assert.equal(res.statusCode, 400);
});
