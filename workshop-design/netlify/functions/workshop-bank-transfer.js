'use strict';

const {
  WORKSHOP_DATE, WORKSHOP_NAME, highLevelPayload, normalizeAttendance, orderValues, parseJson, postWebhook,
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
      event_type: 'bank_transfer_submitted', registration_id: registration.registration_id,
      email: registration.email, phone: registration.phone,
      workshop_name: WORKSHOP_NAME, workshop_date: WORKSHOP_DATE, attendance_type: attendanceType,
      ...orderValues(data.add_on_selected), payment_status: 'Unpaid', payment_method: 'bank_transfer',
      registration_status: 'Payment Pending'
    };
    await postWebhook('HIGHLEVEL_BANK_TRANSFER_WEBHOOK_URL', highLevelPayload(payload));
    await saveRegistration(registration.registration_id, { ...registration, ...payload });
    return response(202, { ok: true, registration_id: registration.registration_id, payment_status: 'Unpaid' });
  } catch (error) {
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'Bank-transfer submission could not be recorded.' });
  }
};
