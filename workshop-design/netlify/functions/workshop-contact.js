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

  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  const host = headers.host;
  const origin = headers.origin;
  const forwardedProto = (headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const isLocal = host && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); } catch (_) { /* Missing or invalid Origin is rejected below. */ }
  if (!host || !parsedOrigin || parsedOrigin.host !== host || parsedOrigin.origin !== origin ||
      !(forwardedProto === 'https' || (isLocal && parsedOrigin.protocol === 'http:'))) {
    return response(403, { ok: false, error: 'Request origin is not allowed.' });
  }

  if (!/^application\/json(?:\s*;|\s*$)/i.test(headers['content-type'] || '')) {
    return response(415, { ok: false, error: 'JSON content is required.' });
  }

  const destination = process.env.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT;
  if (!destination) return response(503, { ok: false, error: 'Registration contact endpoint is not configured.' });

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret) return response(503, { ok: false, error: 'Registration protection is not configured.' });

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

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return response(400, { ok: false, error: 'Invalid registration data.' });
  }

  const token = typeof data.turnstile_token === 'string' ? data.turnstile_token.trim().slice(0, 2048) : '';
  if (!token) return response(400, { ok: false, error: 'Complete the security check and try again.' });

  const verifyController = new AbortController();
  const verifyTimeout = setTimeout(() => verifyController.abort(), 5000);
  try {
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: turnstileSecret, response: token, ...(headers['x-nf-client-connection-ip'] ? { remoteip: headers['x-nf-client-connection-ip'] } : {}) }),
      signal: verifyController.signal
    });
    if (!verification.ok) return response(503, { ok: false, error: 'Security check is temporarily unavailable.' });
    const result = await verification.json();
    if (!result.success || result.hostname !== host || result.action !== 'registration') {
      return response(400, { ok: false, error: 'Security check failed. Please try again.' });
    }
  } catch (_) {
    return response(503, { ok: false, error: 'Security check is temporarily unavailable.' });
  } finally {
    clearTimeout(verifyTimeout);
  }

  const email = typeof data.email === 'string' ? data.email.trim().slice(0, 254) : '';
  const phone = typeof data.phone === 'string' ? data.phone.trim().slice(0, 40) : '';
  const firstName = typeof data.first_name === 'string' ? data.first_name.trim().slice(0, 80) : '';
  const attendance = data.attendance_type;
  if (!firstName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7 || !['karachi', 'online'].includes(attendance)) {
    return response(400, { ok: false, error: 'Name, valid email, phone, and attendance choice are required.' });
  }

  // These values are lead metadata only; payment and order confirmation are server/provider-owned.
  // This endpoint records the initial lead only; checkout selections are not trusted here.
  const orderBump = false;
  const payload = {
    first_name: firstName,
    last_name: typeof data.last_name === 'string' ? data.last_name.trim().slice(0, 100) : '',
    email,
    phone,
    workshop_name: 'High-Ticket Sales Workshop',
    workshop_date: '2026-10-24',
    attendance_type: attendance,
    registration_status: 'Landing Page Lead',
    payment_status: 'Unpaid',
    payment_amount: 5000,
    order_bump: orderBump
  };
  const attribution = data.attribution && typeof data.attribution === 'object' ? data.attribution : {};
  for (const field of ATTRIBUTION_FIELDS) {
    const value = attribution[field];
    if (typeof value === 'string') payload[field] = value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 300);
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
