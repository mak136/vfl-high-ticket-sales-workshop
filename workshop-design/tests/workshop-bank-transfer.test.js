'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handler: bankTransfer } = require('../netlify/functions/workshop-bank-transfer.js');
const { handler: paymentProof } = require('../netlify/functions/workshop-payment-proof.js');
const { saveRegistration, signRegistration } = require('../netlify/functions/workshop-shared.js');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const secret = 'a-secure-workshop-signing-secret-with-32-chars';

function request(body) {
  return {
    httpMethod: 'POST',
    headers: {
      host: 'workshop.example.test',
      origin: 'https://workshop.example.test',
      'x-forwarded-proto': 'https',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

test.beforeEach(() => {
  process.env.WORKSHOP_SIGNING_SECRET = secret;
  process.env.WORKSHOP_REGISTRATION_STORE = 'memory';
  process.env.HIGHLEVEL_BANK_TRANSFER_WEBHOOK_URL = 'https://hooks.example.test/bank-transfer';
});

test.after(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

test('bank transfer stores private proof and sends only a signed proof link to HighLevel', async () => {
  const registrationId = 'WS-20261025-proof-test';
  const registration = {
    registration_id: registrationId,
    email: 'amina@example.com',
    phone: '03001234567',
    first_name: 'Amina',
    last_name: 'Khan',
    attendance_type: 'online'
  };
  await saveRegistration(registrationId, registration);
  const registrationToken = signRegistration(registration, secret);
  let webhookPayload;
  global.fetch = async (_url, options) => {
    webhookPayload = JSON.parse(options.body);
    return { ok: true };
  };

  const result = await bankTransfer(request({
    registration_token: registrationToken,
    attendance_type: 'online',
    payment_proof: {
      mime_type: 'image/jpeg',
      data: Buffer.from('small-test-image').toString('base64'),
      original_name: 'receipt.jpg'
    }
  }));

  assert.equal(result.statusCode, 202);
  assert.equal(webhookPayload.paymentStatus, 'Unpaid');
  assert.equal(webhookPayload.registrationStatus, 'Payment Pending');
  assert.equal(webhookPayload.paymentMethod, 'bank_transfer');
  assert.equal('payment_proof' in webhookPayload, false);
  assert.match(webhookPayload.paymentProofUrl, /^https:\/\/workshop\.example\.test\/\.netlify\/functions\/workshop-payment-proof\?token=/);

  const proofToken = new URL(webhookPayload.paymentProofUrl).searchParams.get('token');
  const proofResult = await paymentProof({ httpMethod: 'GET', queryStringParameters: { token: proofToken } });
  assert.equal(proofResult.statusCode, 200);
  assert.equal(proofResult.isBase64Encoded, true);
  assert.equal(Buffer.from(proofResult.body, 'base64').toString('utf8'), 'small-test-image');
});

test('bank transfer rejects missing or malformed proof data', async () => {
  const registration = {
    registration_id: 'WS-20261025-invalid-proof',
    email: 'test@example.com',
    phone: '03001234567'
  };
  const token = signRegistration(registration, secret);
  const result = await bankTransfer(request({
    registration_token: token,
    attendance_type: 'online',
    payment_proof: { mime_type: 'text/html', data: 'not-an-image' }
  }));
  assert.equal(result.statusCode, 400);
});

