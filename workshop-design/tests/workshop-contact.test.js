'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/workshop-contact.js');

const originalEndpoint = process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT;
const originalFetch = global.fetch;

test.after(() => {
  if (originalEndpoint === undefined) delete process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT;
  else process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT = originalEndpoint;
  global.fetch = originalFetch;
});

test('CRM proxy rejects unsupported methods and missing private endpoint', async () => {
  process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT = '';
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await handler({ httpMethod: 'POST', body: '{}' })).statusCode, 503);
});

test('CRM proxy validates required contact and attendance fields', async () => {
  process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT = 'https://hooks.example.test/intake';
  const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ first_name: 'A', email: 'invalid', phone: '123', attendance_type: 'mars' }) });
  assert.equal(result.statusCode, 400);
});

test('CRM proxy forwards normalized contact and attribution without changing payment status', async () => {
  process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT = 'https://hooks.example.test/intake';
  let forwarded;
  global.fetch = async (url, options) => {
    forwarded = { url, options, body: JSON.parse(options.body) };
    return { ok: true };
  };
  const result = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      first_name: '  Amina ', last_name: '  Khan ', email: 'amina@example.com', phone: '03001234567',
      attendance_type: 'online', order_bump: true, registration_status: 'Checkout Started',
      payment_status: 'Paid', payment_amount: 999999,
      attribution: { utm_source: 'community', last_touch_source: 'community' }
    })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(forwarded.url, 'https://hooks.example.test/intake');
  assert.equal(forwarded.body.first_name, 'Amina');
  assert.equal(forwarded.body.last_name, 'Khan');
  assert.equal(forwarded.body.registration_status, 'Checkout Started');
  assert.equal(forwarded.body.payment_status, 'Unpaid');
  assert.equal(forwarded.body.payment_amount, 10000);
  assert.equal(forwarded.body.utm_source, 'community');
});

