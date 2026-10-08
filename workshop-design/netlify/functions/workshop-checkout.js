'use strict';

const {
  WORKSHOP_DATE, WORKSHOP_NAME, connectBlobs, highLevelPayload, normalizeAttendance, orderValues, parseJson, postWebhook,
  requireSameOrigin, response, saveRegistration, verifyRegistration
} = require('./workshop-shared.js');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  if (!requireSameOrigin(event)) return response(403, { ok: false, error: 'Request origin is not allowed.' });
  try {
    const data = parseJson(event, 5000);
    const registration = verifyRegistration(data.registration_token, process.env.WORKSHOP_SIGNING_SECRET || '');
    const attendanceType = normalizeAttendance(data.attendance_type);
    if (!registration || !attendanceType) return response(401, { ok: false, error: 'Registration session is invalid or expired.' });
    const payload = {
      event_type: 'checkout_started', registration_id: registration.registration_id,
      email: registration.email, phone: registration.phone,
      workshop_name: WORKSHOP_NAME, workshop_date: WORKSHOP_DATE, attendance_type: attendanceType,
      ...orderValues(data.add_on_selected), payment_status: 'Unpaid', registration_status: 'Checkout Started'
    };
    await postWebhook('HIGHLEVEL_CHECKOUT_WEBHOOK_URL', highLevelPayload(payload));
    await connectBlobs(event);
    await saveRegistration(registration.registration_id, { ...registration, ...payload });
    return response(200, { ok: true, registration_id: registration.registration_id, ...orderValues(data.add_on_selected) });
  } catch (error) {
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'Checkout could not be started right now.' });
  }
};
