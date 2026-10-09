'use strict';

const crypto = require('node:crypto');
const {
  WORKSHOP_NAME, clean, connectBlobs, getRegistration, headersFor, parseJson,
  requireSameOrigin, response, verifyRegistration
} = require('./workshop-shared.js');

const PAYFAST_URLS = Object.freeze({
  uat: {
    token: 'https://ipguat.apps.net.pk/Ecommerce/api/Transaction/GetAccessToken',
    form: 'https://ipguat.apps.net.pk/Ecommerce/api/Transaction/PostTransaction'
  },
  live: {
    token: 'https://ipg1.apps.net.pk/Ecommerce/api/Transaction/GetAccessToken',
    form: 'https://ipg1.apps.net.pk/Ecommerce/api/Transaction/PostTransaction'
  }
});

function payfastEnvironment() {
  const mode = String(process.env.PAYFAST_MODE || 'uat').toLowerCase();
  if (!PAYFAST_URLS[mode]) throw Object.assign(new Error('PayFast mode is invalid.'), { statusCode: 500 });
  return { mode, ...PAYFAST_URLS[mode] };
}

function publicUrl() {
  const value = (process.env.WORKSHOP_PUBLIC_URL || 'https://workshop.revenueincarnate.com').replace(/\/$/, '');
  let url;
  try { url = new URL(value); } catch (_) { throw Object.assign(new Error('Workshop public URL is invalid.'), { statusCode: 500 }); }
  if (url.protocol !== 'https:') throw Object.assign(new Error('Workshop public URL must use HTTPS.'), { statusCode: 500 });
  return url.origin;
}

async function accessToken({ basketId, amount }) {
  const merchantId = clean(process.env.PAYFAST_MERCHANT_ID, 80);
  const securedKey = process.env.PAYFAST_SECURED_KEY || '';
  if (!merchantId || !securedKey) throw Object.assign(new Error('PayFast UAT is not configured.'), { statusCode: 503 });
  const { token } = payfastEnvironment();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const result = await fetch(token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'Revenue-Incarnate-Workshop/1.0'
      },
      body: new URLSearchParams({
        MERCHANT_ID: merchantId,
        SECURED_KEY: securedKey,
        BASKET_ID: basketId,
        TXNAMT: amount.toFixed(2),
        CURRENCY_CODE: 'PKR'
      }),
      signal: controller.signal
    });
    if (!result.ok) throw Object.assign(new Error('PayFast could not start checkout.'), { statusCode: 502 });
    const body = await result.json();
    const value = clean(body.ACCESS_TOKEN || body.access_token, 4000);
    if (!value) throw Object.assign(new Error('PayFast did not return an access token.'), { statusCode: 502 });
    return { merchantId, token: value };
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  if (!requireSameOrigin(event)) return response(403, { ok: false, error: 'Request origin is not allowed.' });
  try {
    const data = parseJson(event, 5000);
    const signed = verifyRegistration(data.registration_token, process.env.WORKSHOP_SIGNING_SECRET || '');
    if (!signed || !signed.registration_id) return response(401, { ok: false, error: 'Registration session is invalid or expired.' });
    await connectBlobs(event);
    const registration = await getRegistration(signed.registration_id);
    if (!registration || registration.email !== signed.email || registration.phone !== signed.phone) {
      return response(401, { ok: false, error: 'Registration could not be verified.' });
    }
    const amount = Number(registration.total_order_value);
    if (!Number.isFinite(amount) || amount <= 0 || registration.currency !== 'PKR') {
      return response(400, { ok: false, error: 'The order amount is invalid.' });
    }
    const { merchantId, token } = await accessToken({ basketId: registration.registration_id, amount });
    const { form, mode } = payfastEnvironment();
    const site = publicUrl();
    const headers = headersFor(event);
    const orderDate = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const fields = {
      CURRENCY_CODE: 'PKR',
      MERCHANT_ID: merchantId,
      MERCHANT_NAME: clean(process.env.PAYFAST_MERCHANT_NAME || 'Revenue Incarnate', 100),
      TOKEN: token,
      SUCCESS_URL: `${site}/thank-you/?payment=success&basket_id=${encodeURIComponent(registration.registration_id)}`,
      FAILURE_URL: `${site}/thank-you/?payment=failed&basket_id=${encodeURIComponent(registration.registration_id)}`,
      CHECKOUT_URL: `${site}/.netlify/functions/workshop-payfast-callback`,
      CUSTOMER_EMAIL_ADDRESS: registration.email,
      CUSTOMER_MOBILE_NO: registration.phone,
      TXNAMT: amount.toFixed(2),
      BASKET_ID: registration.registration_id,
      ORDER_DATE: orderDate,
      SIGNATURE: crypto.randomBytes(16).toString('hex'),
      VERSION: 'REVENUE-INCARNATE-1.0',
      TXNDESC: `${WORKSHOP_NAME} - ${registration.attendance_type}`,
      PROCCODE: '00',
      TRAN_TYPE: 'ECOMM_PURCHASE',
      RECURRING_TXN: 'FALSE',
      CUSTOMER_NAME: `${registration.first_name || ''} ${registration.last_name || ''}`.trim(),
      MERCHANT_CUSTOMER_ID: registration.registration_id,
      CUSTOMER_IPADDRESS: headers['x-nf-client-connection-ip'] || '',
      COUNTRY: 'PK',
      MERCHANT_USERAGENT: clean(headers['user-agent'], 500),
      'ITEMS[0][SKU]': 'VFL-WORKSHOP-20261025',
      'ITEMS[0][NAME]': WORKSHOP_NAME,
      'ITEMS[0][PRICE]': amount.toFixed(2),
      'ITEMS[0][QTY]': '1'
    };
    return response(200, { ok: true, environment: mode, form_url: form, fields });
  } catch (error) {
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'PayFast checkout could not be started.' });
  }
};

'use strict';

const {
  connectBlobs, getRegistration, parseJson, requireSameOrigin, response, verifyRegistration
} = require('./workshop-shared.js');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  if (!requireSameOrigin(event)) return response(403, { ok: false, error: 'Request origin is not allowed.' });
  try {
    const data = parseJson(event, 5000);
    const signed = verifyRegistration(data.registration_token, process.env.WORKSHOP_SIGNING_SECRET || '');
    if (!signed || !signed.registration_id) return response(401, { ok: false, error: 'Registration session is invalid or expired.' });
    await connectBlobs(event);
    const registration = await getRegistration(signed.registration_id);
    if (!registration || registration.email !== signed.email || registration.phone !== signed.phone) {
      return response(404, { ok: false, error: 'Registration was not found.' });
    }
    const paid = registration.payment_status === 'Paid' && Boolean(registration.ticket_id && registration.ticket_url);
    return response(200, {
      ok: true,
      paid,
      registration_id: registration.registration_id,
      payment_status: registration.payment_status || 'Unpaid',
      amount_paid: paid ? Number(registration.amount_paid || 0) : 0,
      currency: registration.currency || 'PKR',
      attendance_type: registration.attendance_type || '',
      ticket_id: paid ? registration.ticket_id : '',
      ticket_url: paid ? registration.ticket_url : ''
    });
  } catch (error) {
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'Payment status is temporarily unavailable.' });
  }
};

