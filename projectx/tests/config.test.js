'use strict';
// Checks public/config.js for the mistakes that break the site or the checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../public/config.js');

const VIBES = ['afro', 'techno', 'hiphop'];
const STATUSES = ['on-sale', 'selling-fast', 'early-bird', 'sold-out'];

test('contact details are in the expected format', () => {
  const c = config.contact;
  assert.match(c.whatsapp, /^(\d{8,15})?$/, 'whatsapp: digits only, with country code, like 971501234567');
  assert.doesNotMatch(c.instagram, /\s|\//, 'instagram: just the handle');
  assert.ok(!c.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email), 'email looks wrong');
});

test('every event is complete and consistent', () => {
  const ids = new Set();
  for (const ev of config.events) {
    const where = `event ${ev.id}`;
    assert.ok(ev.id && !ids.has(ev.id), `${where}: id missing or used twice`);
    ids.add(ev.id);
    for (const key of ['number', 'title', 'start', 'end', 'area']) assert.ok(ev[key], `${where}: ${key} is missing`);
    assert.ok(!Number.isNaN(Date.parse(ev.start)), `${where}: start is not a date`);
    assert.ok(Date.parse(ev.end) > Date.parse(ev.start), `${where}: end must be after start`);
    assert.match(ev.start, /\+04:00$/, `${where}: write times in Dubai time, ending +04:00`);
    assert.ok(VIBES.includes(ev.vibe), `${where}: vibe must be one of ${VIBES.join(', ')}`);
    assert.ok(STATUSES.includes(ev.status), `${where}: status must be one of ${STATUSES.join(', ')}`);
    assert.ok(Array.isArray(ev.genres) && ev.genres.length, `${where}: add at least one genre`);
    assert.ok(!ev.ticketUrl || /^https:\/\//.test(ev.ticketUrl), `${where}: ticketUrl must start with https://`);
    assert.ok(Array.isArray(ev.lineup), `${where}: lineup must be a list`);

    assert.ok(Array.isArray(ev.tiers) && ev.tiers.length, `${where}: add at least one ticket type`);
    const tierIds = new Set();
    for (const t of ev.tiers) {
      assert.ok(t.id && !tierIds.has(t.id), `${where}: ticket id ${t.id} missing or used twice`);
      tierIds.add(t.id);
      assert.ok(t.name, `${where}: ticket ${t.id} needs a name`);
      assert.ok(Number.isFinite(t.price) && t.price >= 2, `${where}: ticket ${t.id} price must be a number of at least 2 (Stripe minimum)`);
      assert.ok(t.maxPerOrder === undefined || (Number.isInteger(t.maxPerOrder) && t.maxPerOrder > 0), `${where}: ticket ${t.id} maxPerOrder must be a whole number`);
    }
  }
});

test('payments are set up for AED with UAE VAT', () => {
  assert.equal(config.payments.currency, 'AED');
  assert.equal(config.payments.vatRate, 0.05);
  assert.ok(config.payments.endpoint.startsWith('/'));
});
