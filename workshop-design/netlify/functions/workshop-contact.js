'use strict';

const crypto = require('node:crypto');
const {
  CURRENCY, WORKSHOP_DATE, WORKSHOP_NAME, clean, connectBlobs, highLevelPayload, normalizeAttendance, normalizeAttribution,
  orderValues, parseJson, postWebhook, requireSameOrigin, response, saveRegistration, signRegistration, verifyTurnstile
} = require('./workshop-shared.js');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  if (!requireSameOrigin(event)) return response(403, { ok: false, error: 'Request origin is not allowed.' });
  const contentType = (event.headers || {})['content-type'] || (event.headers || {})['Content-Type'] || '';
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return response(415, { ok: false, error: 'JSON content is required.' });

  let phase = 'request_validation';
  try {
    const data = parseJson(event);
    phase = 'turnstile_verification';
    await verifyTurnstile(clean(data.turnstile_token, 2048), event);
    const email = clean(data.email, 254).toLowerCase();
    const phone = clean(data.phone, 40);
    const firstName = clean(data.first_name, 80);
    const lastName = clean(data.last_name, 100);
    const attendanceType = normalizeAttendance(data.attendance_type);
    if (!firstName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7 || !attendanceType) {
      return response(400, { ok: false, error: 'Name, valid email, phone, and attendance choice are required.' });
    }

    const registrationId = `WS-${WORKSHOP_DATE.replaceAll('-', '')}-${crypto.randomUUID()}`;
    const payload = {
      event_type: 'registration_submitted', registration_id: registrationId, form_submitted: true,
      first_name: firstName, last_name: lastName, email, phone,
      workshop_name: WORKSHOP_NAME, workshop_date: WORKSHOP_DATE, attendance_type: attendanceType,
      ...orderValues(false), payment_status: 'Unpaid', payment_method: '', amount_paid: 0,
      registration_status: 'Lead Captured', ...normalizeAttribution(data.attribution)
    };
    phase = 'highlevel_handoff';
    await postWebhook('HIGHLEVEL_REGISTRATION_WEBHOOK_URL', highLevelPayload(payload), 'HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT');
    phase = 'registration_storage';
    await connectBlobs(event);
    await saveRegistration(registrationId, payload);
    phase = 'registration_signing';
    const registrationToken = signRegistration({
      registration_id: registrationId, email, phone, first_name: firstName, last_name: lastName
    }, process.env.WORKSHOP_SIGNING_SECRET || '');
    return response(200, { ok: true, registration_id: registrationId, registration_token: registrationToken, currency: CURRENCY });
  } catch (error) {
    console.error('[workshop-contact] registration failed', {
      phase,
      name: error && error.name,
      message: error && error.message,
      statusCode: error && error.statusCode
    });
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'Registration could not be saved right now.' });
  }
};
