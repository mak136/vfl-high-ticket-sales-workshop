'use strict';

const ATTRIBUTION_FIELDS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'landing_page', 'referrer', 'first_touch_source',
  'first_touch_campaign', 'first_touch_landing_page', 'first_touch_referrer',
  'last_touch_source', 'last_touch_campaign', 'last_touch_medium',
  'last_touch_content', 'last_touch_term', 'last_touch_fbclid',
  'last_touch_gclid', 'last_touch_landing_page', 'last_touch_referrer'
];

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });

  const destination = process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT;
  if (!destination) return response(503, { ok: false, error: 'Registration contact endpoint is not configured.' });

  let endpoint;
  try {
    endpoint = new URL(destination);
    if (endpoint.protocol !== 'https:') throw new Error('HTTPS is required.');
  } catch (_) {
    return response(500, { ok: false, error: 'Registration contact endpoint configuration is invalid.' });
  }

  let data;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    if (Buffer.byteLength(raw, 'utf8') > 12000) return response(413, { ok: false, error: 'Request is too large.' });
    data = JSON.parse(raw);
  } catch (_) {
    return response(400, { ok: false, error: 'Invalid registration data.' });
  }

  const email = typeof data.email === 'string' ? data.email.trim().slice(0, 254) : '';
  const phone = typeof data.phone === 'string' ? data.phone.trim().slice(0, 40) : '';
  const firstName = typeof data.first_name === 'string' ? data.first_name.trim().slice(0, 80) : '';
  const attendance = data.attendance_type;
  if (!firstName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7 || !['karachi', 'online'].includes(attendance)) {
    return response(400, { ok: false, error: 'Name, valid email, phone, and attendance choice are required.' });
  }

  const orderBump = Boolean(data.order_bump);
  const status = data.registration_status === 'Checkout Started' ? 'Checkout Started' : 'Landing Page Lead';
  const payload = {
    first_name: firstName,
    last_name: String(data.last_name || '').trim().slice(0, 100),
    email,
    phone,
    workshop_name: 'High-Ticket Sales Workshop',
    workshop_date: '2026-10-24',
    attendance_type: attendance,
    registration_status: status,
    payment_status: 'Unpaid',
    payment_amount: 5000 + (orderBump ? 5000 : 0),
    order_bump: orderBump
  };
  const attribution = data.attribution && typeof data.attribution === 'object' ? data.attribution : {};
  for (const field of ATTRIBUTION_FIELDS) {
    const value = attribution[field];
    if (typeof value === 'string') payload[field] = value.slice(0, 1000);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!upstream.ok) return response(502, { ok: false, error: 'Contact could not be saved right now.' });
    return response(200, { ok: true });
  } catch (_) {
    return response(502, { ok: false, error: 'Contact could not be saved right now.' });
  } finally {
    clearTimeout(timeout);
  }
};
