'use strict';

const { headersFor, postWebhook, response } = require('./workshop-shared.js');

function parseCallback(event) {
  const contentType = headersFor(event)['content-type'] || '';
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > 16000) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
  if (/application\/json/i.test(contentType)) return JSON.parse(raw);
  return Object.fromEntries(new URLSearchParams(raw));
}

function pick(data, ...keys) {
  for (const key of keys) if (data[key] !== undefined && data[key] !== null && String(data[key]).trim()) return String(data[key]).trim();
  return '';
}

async function payfastAccessToken(customerIp) {
  const base = process.env.PAYFAST_API_BASE_URL;
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const securedKey = process.env.PAYFAST_SECURED_KEY;
  if (!base || !merchantId || !securedKey) throw Object.assign(new Error('PayFast verification is not configured.'), { statusCode: 503 });
  const result = await fetch(`${base.replace(/\/$/, '')}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ merchant_id: merchantId, secured_key: securedKey, grant_type: 'client_credentials', customer_ip: customerIp || '127.0.0.1' })
  });
  if (!result.ok) throw Object.assign(new Error('PayFast token verification failed.'), { statusCode: 502 });
  const body = await result.json();
  const token = body.token || body.access_token;
  if (!token) throw Object.assign(new Error('PayFast did not return a verification token.'), { statusCode: 502 });
  return { base: base.replace(/\/$/, ''), token };
}

async function verifyPayfastTransaction(transactionId, customerIp) {
  const { base, token } = await payfastAccessToken(customerIp);
  const result = await fetch(`${base}/transaction/${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  if (!result.ok) throw Object.assign(new Error('PayFast transaction verification failed.'), { statusCode: 502 });
  return result.json();
}

async function claimTransaction(transactionId, record) {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore('workshop-payments');
  return store.setJSON(`payfast/${transactionId}`, record, { onlyIfNew: true });
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  try {
    const data = parseCallback(event);
    const transactionId = pick(data, 'transaction_id', 'TRANSACTION_ID');
    const callbackBasketId = pick(data, 'basket_id', 'BASKET_ID');
    if (!transactionId || !callbackBasketId) return response(400, { ok: false, error: 'Missing PayFast transaction data.' });
    const headers = headersFor(event);
    const verified = await verifyPayfastTransaction(transactionId, headers['x-nf-client-connection-ip'] || '');
    const statusCode = pick(verified, 'status_code', 'code');
    const successCodes = new Set((process.env.PAYFAST_SUCCESS_CODES || '00,79').split(',').map(value => value.trim()));
    const basketId = pick(verified, 'basket_id', 'BASKET_ID');
    const amount = Number(pick(verified, 'txnamt', 'amount', 'TXNAMT'));
    if (!successCodes.has(statusCode) || basketId !== callbackBasketId || ![5000, 10000].includes(amount)) {
      return response(400, { ok: false, error: 'PayFast transaction did not pass server verification.' });
    }
    const verifiedAt = new Date().toISOString();
    const claimed = await claimTransaction(transactionId, { transaction_id: transactionId, registration_id: basketId, amount, verified_at: verifiedAt });
    if (!claimed.modified) return response(200, { ok: true, duplicate: true });
    await postWebhook('HIGHLEVEL_PAID_WEBHOOK_URL', {
      event_type: 'payment_verified', registration_id: basketId, payfast_transaction_id: transactionId,
      amount_paid: amount, total_order_value: amount, currency: 'PKR', payment_status: 'Paid',
      payment_method: pick(verified, 'payment_method', 'account_type', 'instrument_type') || 'payfast',
      verified_payment_timestamp: verifiedAt, registration_status: 'Paid / Registered'
    });
    return response(200, { ok: true, duplicate: false });
  } catch (error) {
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'Payment verification failed.' });
  }
};
