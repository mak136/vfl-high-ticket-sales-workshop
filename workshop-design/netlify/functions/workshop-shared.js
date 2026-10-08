'use strict';

const crypto = require('node:crypto');

const ATTRIBUTION_FIELDS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'landing_page', 'referrer', 'first_touch_source',
  'first_touch_campaign', 'first_touch_landing_page', 'first_touch_referrer',
  'last_touch_source', 'last_touch_campaign', 'last_touch_medium',
  'last_touch_content', 'last_touch_term', 'last_touch_fbclid',
  'last_touch_gclid', 'last_touch_landing_page', 'last_touch_referrer'
];

const BASE_TICKET_AMOUNT = 5000;
const ADD_ON_AMOUNT = 5000;
const CURRENCY = 'PKR';
const WORKSHOP_NAME = 'High-Ticket Sales Workshop';
const WORKSHOP_DATE = '2026-10-25';
const TEST_REGISTRATIONS = new Map();
const TEST_PAYMENT_PROOFS = new Map();
const TEST_TICKETS = new Map();

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function headersFor(event) {
  return Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
}

function requireSameOrigin(event) {
  const headers = headersFor(event);
  const host = headers.host;
  const origin = headers.origin;
  const forwardedProto = (headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const isLocal = host && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); } catch (_) { return false; }
  return Boolean(host && parsedOrigin.host === host && parsedOrigin.origin === origin &&
    (forwardedProto === 'https' || (isLocal && parsedOrigin.protocol === 'http:')));
}

function parseJson(event, maxBytes = 12000) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
  let data;
  try { data = JSON.parse(raw); } catch (_) { throw Object.assign(new Error('Invalid JSON.'), { statusCode: 400 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('Invalid request data.'), { statusCode: 400 });
  }
  return data;
}

function clean(value, max = 300) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
}

function normalizeAttendance(value) {
  if (value === 'online') return 'online';
  if (value === 'karachi' || value === 'onsite') return 'onsite';
  return '';
}

function normalizeAttribution(input) {
  const source = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(ATTRIBUTION_FIELDS.map(field => [field, clean(source[field])]).filter(([, value]) => value));
}

function orderValues(addOnSelected) {
  const addOn = Boolean(addOnSelected);
  return {
    ticket_type: 'Workshop Ticket',
    base_ticket_amount: BASE_TICKET_AMOUNT,
    add_on_selected: addOn,
    add_on_amount: addOn ? ADD_ON_AMOUNT : 0,
    total_order_value: BASE_TICKET_AMOUNT + (addOn ? ADD_ON_AMOUNT : 0),
    currency: CURRENCY
  };
}

const HIGHLEVEL_FIELD_NAMES = {
  event_type: 'event',
  registration_id: 'registrationId',
  form_submitted: 'formSubmitted',
  first_name: 'firstName',
  last_name: 'lastName',
  workshop_name: 'workshopName',
  workshop_date: 'workshopDate',
  attendance_type: 'attendanceType',
  ticket_type: 'ticketType',
  base_ticket_amount: 'baseTicketAmount',
  add_on_selected: 'addonSelected',
  add_on_amount: 'addonAmount',
  total_order_value: 'totalOrderValue',
  amount_paid: 'amountPaid',
  payment_status: 'paymentStatus',
  payment_method: 'paymentMethod',
  payment_proof_url: 'paymentProofUrl',
  payment_proof_received_at: 'paymentProofReceivedAt',
  payfast_transaction_id: 'payfastTransactionId',
  verified_payment_timestamp: 'verifiedPaymentTimestamp',
  ticket_id: 'ticketId',
  ticket_url: 'ticketUrl',
  registration_status: 'registrationStatus',
  first_touch_source: 'firstTouchSource',
  first_touch_campaign: 'firstTouchCampaign',
  first_touch_landing_page: 'firstTouchLandingPage',
  first_touch_referrer: 'firstTouchReferrer',
  last_touch_source: 'lastTouchSource',
  last_touch_campaign: 'lastTouchCampaign',
  last_touch_medium: 'lastTouchMedium',
  last_touch_content: 'lastTouchContent',
  last_touch_term: 'lastTouchTerm',
  last_touch_fbclid: 'lastTouchFbclid',
  last_touch_gclid: 'lastTouchGclid',
  last_touch_landing_page: 'lastTouchLandingPage',
  last_touch_referrer: 'lastTouchReferrer',
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_content: 'utmContent',
  utm_term: 'utmTerm',
  landing_page: 'landingPage'
};

function highLevelPayload(payload) {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [HIGHLEVEL_FIELD_NAMES[key] || key, value]));
}

async function registrationStore() {
  if (process.env.WORKSHOP_REGISTRATION_STORE === 'memory') {
    return {
      setJSON: async (key, value) => TEST_REGISTRATIONS.set(key, structuredClone(value)),
      get: async key => TEST_REGISTRATIONS.get(key) || null
    };
  }
  const { getStore } = await import('@netlify/blobs');
  return getStore('workshop-registrations');
}

async function saveRegistration(registrationId, record) {
  const store = await registrationStore();
  await store.setJSON(`registrations/${registrationId}`, record);
}

async function getRegistration(registrationId) {
  const store = await registrationStore();
  return store.get(`registrations/${registrationId}`, { type: 'json' });
}

async function paymentProofStore() {
  if (process.env.WORKSHOP_REGISTRATION_STORE === 'memory') {
    return {
      setJSON: async (key, value) => TEST_PAYMENT_PROOFS.set(key, structuredClone(value)),
      get: async key => TEST_PAYMENT_PROOFS.get(key) || null
    };
  }
  const { getStore } = await import('@netlify/blobs');
  return getStore('workshop-payment-proofs');
}

async function savePaymentProof(registrationId, record) {
  const store = await paymentProofStore();
  await store.setJSON(`proofs/${registrationId}`, record);
}

async function getPaymentProof(registrationId) {
  const store = await paymentProofStore();
  return store.get(`proofs/${registrationId}`, { type: 'json' });
}

async function ticketStore() {
  if (process.env.WORKSHOP_REGISTRATION_STORE === 'memory') {
    return {
      setJSON: async (key, value, options = {}) => {
        if (options.onlyIfNew && TEST_TICKETS.has(key)) return { modified: false };
        TEST_TICKETS.set(key, structuredClone(value));
        return { modified: true };
      },
      get: async key => TEST_TICKETS.get(key) || null
    };
  }
  const { getStore } = await import('@netlify/blobs');
  return getStore('workshop-tickets');
}

async function getTicket(registrationId) {
  return (await ticketStore()).get(`tickets/${registrationId}`, { type: 'json' });
}

async function issueTicket(registration, verifiedPayment) {
  const existing = await getTicket(registration.registration_id);
  if (existing) return existing;
  const attendanceCode = registration.attendance_type === 'online' ? 'ON' : 'KHI';
  const ticketId = `VFL-25OCT-${attendanceCode}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const ticketToken = signRegistration({
    purpose: 'workshop_ticket', ticket_id: ticketId, registration_id: registration.registration_id
  }, process.env.WORKSHOP_SIGNING_SECRET || '');
  const publicUrl = (process.env.WORKSHOP_PUBLIC_URL || 'https://workshop.revenueincarnate.com').replace(/\/$/, '');
  const ticket = {
    ticket_id: ticketId,
    ticket_url: `${publicUrl}/.netlify/functions/workshop-ticket?token=${encodeURIComponent(ticketToken)}`,
    registration_id: registration.registration_id,
    first_name: registration.first_name,
    last_name: registration.last_name,
    email: registration.email,
    attendance_type: registration.attendance_type,
    status: 'active',
    issued_at: new Date().toISOString(),
    payment: verifiedPayment
  };
  const store = await ticketStore();
  const saved = await store.setJSON(`tickets/${registration.registration_id}`, ticket, { onlyIfNew: true });
  return saved.modified ? ticket : getTicket(registration.registration_id);
}

function signRegistration(payload, secret) {
  if (!secret || secret.length < 32) throw new Error('WORKSHOP_SIGNING_SECRET must contain at least 32 characters.');
  const encoded = Buffer.from(JSON.stringify({ ...payload, issued_at: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyRegistration(token, secret, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  if (!secret || !token || typeof token !== 'string') return null;
  const [encoded, supplied] = token.split('.');
  if (!encoded || !supplied) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!payload.issued_at || Date.now() - payload.issued_at > maxAgeMs || Date.now() < payload.issued_at - 60000) return null;
  return payload;
}

async function verifyTurnstile(token, event) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw Object.assign(new Error('Registration protection is not configured.'), { statusCode: 503 });
  if (!token) throw Object.assign(new Error('Complete the security check and try again.'), { statusCode: 400 });
  const headers = headersFor(event);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, ...(headers['x-nf-client-connection-ip'] ? { remoteip: headers['x-nf-client-connection-ip'] } : {}) }),
      signal: controller.signal
    });
    if (!verification.ok) throw Object.assign(new Error('Security check is temporarily unavailable.'), { statusCode: 503 });
    const result = await verification.json();
    if (!result.success || result.hostname !== headers.host || result.action !== 'registration') {
      throw Object.assign(new Error('Security check failed. Please try again.'), { statusCode: 400 });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function webhookUrl(envName, fallbackName) {
  const raw = process.env[envName] || (fallbackName ? process.env[fallbackName] : '');
  if (!raw) throw Object.assign(new Error(`${envName} is not configured.`), { statusCode: 503 });
  let url;
  try { url = new URL(raw); } catch (_) { throw Object.assign(new Error(`${envName} is invalid.`), { statusCode: 500 }); }
  if (url.protocol !== 'https:') throw Object.assign(new Error(`${envName} must use HTTPS.`), { statusCode: 500 });
  return url;
}

async function postWebhook(envName, payload, fallbackName) {
  const url = webhookUrl(envName, fallbackName);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!upstream.ok) throw Object.assign(new Error('HighLevel could not be updated right now.'), { statusCode: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  ADD_ON_AMOUNT, ATTRIBUTION_FIELDS, BASE_TICKET_AMOUNT, CURRENCY, WORKSHOP_DATE, WORKSHOP_NAME,
  clean, getPaymentProof, getRegistration, getTicket, headersFor, highLevelPayload, issueTicket, normalizeAttendance, normalizeAttribution, orderValues,
  parseJson, postWebhook, requireSameOrigin, response, savePaymentProof, saveRegistration, signRegistration, verifyRegistration,
  verifyTurnstile
};
