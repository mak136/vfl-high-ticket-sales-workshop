'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/workshop-contact.js');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const request = body => ({
  httpMethod: 'POST',
  headers: { host: 'workshop.example.test', origin: 'https://workshop.example.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

test.beforeEach(() => {
  process.env.HIGHLEVEL_REGISTRATION_WEBHOOK_URL = 'https://hooks.example.test/intake';
  process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret';
  process.env.WORKSHOP_SIGNING_SECRET = 'a-secure-workshop-signing-secret-with-32-chars';
  process.env.WORKSHOP_REGISTRATION_STORE = 'memory';
});

test.after(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

test('CRM proxy rejects unsupported methods and cross-origin requests', async () => {
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await handler({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode, 403);
});

test('CRM proxy validates required contact and attendance fields', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ success: true, hostname: 'workshop.example.test', action: 'registration' }) });
  const result = await handler(request({ turnstile_token: 'valid', first_name: 'A', email: 'invalid', phone: '123', attendance_type: 'mars' }));
  assert.equal(result.statusCode, 400);
});

test('CRM proxy forwards normalized PKR lead data and returns a signed registration session', async () => {
  let forwarded;
  global.fetch = async (url, options) => {
    if (String(url).includes('turnstile')) return { ok: true, json: async () => ({ success: true, hostname: 'workshop.example.test', action: 'registration' }) };
    forwarded = { url, body: JSON.parse(options.body) };
    return { ok: true };
  };
  const result = await handler(request({
    turnstile_token: 'valid', first_name: '  Amina ', last_name: '  Khan ', email: 'Amina@Example.com', phone: '03001234567',
    attendance_type: 'online', order_bump: true, payment_status: 'Paid', payment_amount: 999999,
    attribution: { utm_source: 'community', last_touch_source: 'community' }
  }));
  const body = JSON.parse(result.body);
  assert.equal(result.statusCode, 200);
  assert.equal(forwarded.url, 'https://hooks.example.test/intake');
  assert.equal(forwarded.body.email, 'amina@example.com');
  assert.equal(forwarded.body.attendanceType, 'online');
  assert.equal(forwarded.body.paymentStatus, 'Unpaid');
  assert.equal(forwarded.body.baseTicketAmount, 5000);
  assert.equal(forwarded.body.totalOrderValue, 5000);
  assert.equal(forwarded.body.currency, 'PKR');
  assert.equal(forwarded.body.utmSource, 'community');
  assert.match(body.registration_id, /^WS-20261025-/);
  assert.match(body.registration_token, /^[^.]+\.[^.]+$/);
});
