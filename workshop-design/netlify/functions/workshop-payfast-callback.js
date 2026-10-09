'use strict';

const crypto = require('node:crypto');
const {
  WORKSHOP_DATE, WORKSHOP_NAME, connectBlobs, getRegistration, highLevelPayload,
  issueTicket, postWebhook, response, saveRegistration
} = require('./workshop-shared.js');

const TEST_CLAIMS = new Map();

function shortId(value) {
  const text = String(value || '');
  return text ? `…${text.slice(-8)}` : 'missing';
}

function callbackLog(level, event, details = {}) {
  const safe = { event, ...details };
  console[level](`[payfast-callback] ${JSON.stringify(safe)}`);
}

function parseCallback(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > 16000) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
  const query = new URLSearchParams(event.rawQuery || '');
  for (const [key, value] of Object.entries(event.queryStringParameters || {})) {
    if (value !== undefined && value !== null) query.set(key, value);
  }
  const body = new URLSearchParams(raw);
  for (const [key, value] of body) query.set(key, value);
  return Object.fromEntries(query);
}

function pick(data, ...keys) {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null && String(data[key]).trim()) return String(data[key]).trim();
  }
  return '';
}

function validHash({ basketId, errorCode, suppliedHash }) {
  const merchantId = process.env.PAYFAST_MERCHANT_ID || '';
  const securedKey = process.env.PAYFAST_SECURED_KEY || '';
  if (!merchantId || !securedKey || !/^[a-f0-9]{64}$/i.test(suppliedHash)) return false;
  const expected = crypto.createHash('sha256')
    .update(`${basketId}|${securedKey}|${merchantId}|${errorCode}`, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(suppliedHash.toLowerCase(), 'hex'));
}

async function claimTransaction(transactionId, record) {
  if (process.env.WORKSHOP_REGISTRATION_STORE === 'memory') {
    if (TEST_CLAIMS.has(transactionId)) return { modified: false };
    TEST_CLAIMS.set(transactionId, record);
    return { modified: true };
  }
  const { getStore } = await import('@netlify/blobs');
  return getStore('workshop-payments').setJSON(`payfast/${transactionId}`, record, { onlyIfNew: true });
}

async function releaseTransaction(transactionId) {
  if (process.env.WORKSHOP_REGISTRATION_STORE === 'memory') return TEST_CLAIMS.delete(transactionId);
  const { getStore } = await import('@netlify/blobs');
  return getStore('workshop-payments').delete(`payfast/${transactionId}`);
}

async function optionalWebhook(envName, payload) {
  if (!process.env[envName]) return;
  await postWebhook(envName, payload);
}

exports.handler = async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, { ok: false, error: 'Method not allowed.' });
  const startedAt = Date.now();
  try {
    await connectBlobs(event);
    const data = parseCallback(event);
    const transactionId = pick(data, 'transaction_id', 'TRANSACTION_ID');
    const basketId = pick(data, 'basket_id', 'BASKET_ID');
    const errorCode = pick(data, 'err_code', 'ERR_CODE');
    const validationHash = pick(data, 'validation_hash', 'VALIDATION_HASH');
    if (!transactionId || !basketId || !errorCode || !validationHash) {
      callbackLog('warn', 'rejected_missing_fields', { method: event.httpMethod });
      return response(400, { ok: false, error: 'Missing PayFast transaction data.' });
    }
    if (!validHash({ basketId, errorCode, suppliedHash: validationHash })) {
      callbackLog('warn', 'rejected_invalid_hash', { basket: shortId(basketId), transaction: shortId(transactionId), errorCode });
      return response(400, { ok: false, error: 'PayFast validation hash did not match.' });
    }
    const registration = await getRegistration(basketId);
    if (!registration) {
      callbackLog('warn', 'rejected_unknown_registration', { basket: shortId(basketId), transaction: shortId(transactionId) });
      return response(400, { ok: false, error: 'Unknown PayFast basket ID.' });
    }

    const amount = Number(pick(data, 'merchant_amount', 'MERCHANT_AMOUNT'));
    const currency = pick(data, 'transaction_currency', 'TRANSACTION_CURRENCY').toUpperCase();
    const paymentMethod = pick(data, 'PaymentName', 'payment_name') || 'PayFast';
    const expectedAmount = Number(registration.total_order_value);
    const eventAt = new Date().toISOString();

    if (errorCode !== '000') {
      const failedPayload = {
        event_type: 'payment_failed', registration_id: basketId,
        email: registration.email, phone: registration.phone,
        payfast_transaction_id: transactionId, amount_paid: 0,
        total_order_value: expectedAmount, currency: 'PKR', payment_status: 'Failed',
        payment_method: paymentMethod, registration_status: 'Payment Failed'
      };
      await saveRegistration(basketId, {
        ...registration, ...failedPayload, payfast_error_code: errorCode,
        payfast_error_message: pick(data, 'err_msg', 'ERR_MSG'), payment_failed_at: eventAt
      });
      await optionalWebhook('HIGHLEVEL_PAYMENT_FAILED_WEBHOOK_URL', highLevelPayload(failedPayload));
      callbackLog('info', 'payment_failed', { basket: shortId(basketId), transaction: shortId(transactionId), errorCode, durationMs: Date.now() - startedAt });
      return response(200, { ok: true, paid: false });
    }

    if (!Number.isFinite(amount) || amount !== expectedAmount || currency !== 'PKR') {
      callbackLog('warn', 'rejected_amount_or_currency', { basket: shortId(basketId), transaction: shortId(transactionId), currency });
      return response(400, { ok: false, error: 'PayFast amount or currency did not match the order.' });
    }
    const claimed = await claimTransaction(transactionId, {
      transaction_id: transactionId, registration_id: basketId, amount, verified_at: eventAt
    });
    if (!claimed.modified) {
      callbackLog('info', 'duplicate_payment', { basket: shortId(basketId), transaction: shortId(transactionId), durationMs: Date.now() - startedAt });
      return response(200, { ok: true, paid: true, duplicate: true });
    }
    try {
      const payment = {
        transaction_id: transactionId, amount_paid: amount, currency: 'PKR',
        payment_method: paymentMethod, verified_at: eventAt
      };
      const ticket = await issueTicket(registration, payment);
      const paidPayload = {
        event_type: 'payment_verified', registration_id: basketId,
        email: registration.email, phone: registration.phone,
        first_name: registration.first_name, last_name: registration.last_name,
        workshop_name: registration.workshop_name || WORKSHOP_NAME,
        workshop_date: registration.workshop_date || WORKSHOP_DATE,
        attendance_type: registration.attendance_type,
        ticket_type: registration.ticket_type,
        base_ticket_amount: registration.base_ticket_amount,
        add_on_selected: registration.add_on_selected,
        payfast_transaction_id: transactionId, amount_paid: amount,
        total_order_value: expectedAmount, currency: 'PKR', payment_status: 'Paid',
        payment_method: paymentMethod, verified_payment_timestamp: eventAt,
        registration_status: 'Paid / Registered', ticket_id: ticket.ticket_id, ticket_url: ticket.ticket_url
      };
      await postWebhook('HIGHLEVEL_PAID_WEBHOOK_URL', highLevelPayload(paidPayload));
      await saveRegistration(basketId, { ...registration, ...paidPayload });
    } catch (error) {
      await releaseTransaction(transactionId);
      throw error;
    }
    callbackLog('info', 'payment_verified', { basket: shortId(basketId), transaction: shortId(transactionId), durationMs: Date.now() - startedAt });
    return response(200, { ok: true, paid: true, duplicate: false });
  } catch (error) {
    callbackLog('error', 'processing_error', { statusCode: error.statusCode || 502, durationMs: Date.now() - startedAt });
    return response(error.statusCode || 502, {
      ok: false, error: error.statusCode ? error.message : 'Payment verification failed.'
    });
  }
};
