'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

process.env.WORKSHOP_REGISTRATION_STORE = 'memory';
process.env.WORKSHOP_SIGNING_SECRET = 'test-signing-secret-that-is-at-least-32-characters';
process.env.PAYFAST_MODE = 'uat';
process.env.PAYFAST_MERCHANT_ID = '102';
process.env.PAYFAST_SECURED_KEY = 'test-secured-key';
process.env.PAYFAST_MERCHANT_NAME = 'Revenue Incarnate';
process.env.HIGHLEVEL_PAID_WEBHOOK_URL = 'https://example.test/paid';

const shared = require('../netlify/functions/workshop-shared.js');
const start = require('../netlify/functions/workshop-payfast-start.js');
const callback = require('../netlify/functions/workshop-payfast-callback.js');

function registration(id) {
  return {
    registration_id: id,
    first_name: 'Test',
    last_name: 'Buyer',
    email: 'buyer@example.com',
    phone: '+923001234567',
    attendance_type: 'online',
    ticket_type: 'Workshop Ticket',
    base_ticket_amount: 5000,
    add_on_selected: false,
    total_order_value: 5000,
    currency: 'PKR'
  };
}

function validationHash(basketId, errorCode) {
  return crypto.createHash('sha256')
    .update(`${basketId}|${process.env.PAYFAST_SECURED_KEY}|${process.env.PAYFAST_MERCHANT_ID}|${errorCode}`)
    .digest('hex');
}

test('PayFast start uses the UAT gateway and keeps the secured key server-side', async () => {
  const record = registration('REG-PAYFAST-START');
  await shared.saveRegistration(record.registration_id, record);
  const token = shared.signRegistration({
    registration_id: record.registration_id,
    email: record.email,
    phone: record.phone
  }, process.env.WORKSHOP_SIGNING_SECRET);
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://ipguat.apps.net.pk/Ecommerce/api/Transaction/GetAccessToken');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('MERCHANT_ID'), '102');
    assert.equal(body.get('SECURED_KEY'), 'test-secured-key');
    assert.equal(body.get('BASKET_ID'), record.registration_id);
    assert.equal(body.get('TXNAMT'), '5000.00');
    return { ok: true, json: async () => ({ ACCESS_TOKEN: 'uat-access-token' }) };
  };
  try {
    const result = await start.handler({
      httpMethod: 'POST',
      headers: {
        host: 'workshop.revenueincarnate.com',
        origin: 'https://workshop.revenueincarnate.com',
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify({ registration_token: token })
    });
    assert.equal(result.statusCode, 200);
    const payload = JSON.parse(result.body);
    assert.equal(payload.environment, 'uat');
    assert.equal(payload.form_url, 'https://ipguat.apps.net.pk/Ecommerce/api/Transaction/PostTransaction');
    assert.equal(payload.fields.BASKET_ID, record.registration_id);
    assert.equal(payload.fields.TXNAMT, '5000.00');
    assert.equal(payload.fields.CHECKOUT_URL, 'https://workshop.revenueincarnate.com/.netlify/functions/workshop-payfast-callback');
    assert.equal(JSON.stringify(payload).includes(process.env.PAYFAST_SECURED_KEY), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('PayFast callback rejects a forged validation hash', async () => {
  const record = registration('REG-PAYFAST-FORGED');
  await shared.saveRegistration(record.registration_id, record);
  const result = await callback.handler({
    httpMethod: 'POST',
    headers: {},
    body: new URLSearchParams({
      basket_id: record.registration_id,
      transaction_id: 'TX-FORGED',
      err_code: '000',
      validation_hash: '0'.repeat(64),
      merchant_amount: '5000.00',
      transaction_currency: 'PKR'
    }).toString()
  });
  assert.equal(result.statusCode, 400);
  assert.match(JSON.parse(result.body).error, /hash/i);
});

test('verified PayFast callback is idempotent and never duplicates the paid webhook', async () => {
  const record = registration('REG-PAYFAST-PAID');
  await shared.saveRegistration(record.registration_id, record);
  const originalFetch = global.fetch;
  let paidWebhookCalls = 0;
  global.fetch = async url => {
    assert.equal(url, process.env.HIGHLEVEL_PAID_WEBHOOK_URL);
    paidWebhookCalls += 1;
    return { ok: true };
  };
  const body = new URLSearchParams({
    basket_id: record.registration_id,
    transaction_id: 'TX-PAID-UNIQUE',
    err_code: '000',
    validation_hash: validationHash(record.registration_id, '000'),
    merchant_amount: '5000.00',
    transaction_currency: 'PKR',
    PaymentName: 'Card'
  }).toString();
  try {
    const first = await callback.handler({ httpMethod: 'POST', headers: {}, body });
    const second = await callback.handler({ httpMethod: 'POST', headers: {}, body });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(JSON.parse(first.body), { ok: true, paid: true, duplicate: false });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(JSON.parse(second.body), { ok: true, paid: true, duplicate: true });
    assert.equal(paidWebhookCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
