'use strict';

const {
  WORKSHOP_DATE, WORKSHOP_NAME, connectBlobs, headersFor, highLevelPayload, normalizeAttendance, orderValues, parseJson, postWebhook,
  requireSameOrigin, response, savePaymentProof, saveRegistration, signRegistration, verifyRegistration
} = require('./workshop-shared.js');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  if (!requireSameOrigin(event)) return response(403, { ok: false, error: 'Request origin is not allowed.' });
  try {
    const data = parseJson(event, 3000000);
    const registration = verifyRegistration(data.registration_token, process.env.WORKSHOP_SIGNING_SECRET || '');
    const attendanceType = normalizeAttendance(data.attendance_type);
    if (!registration || !attendanceType) return response(401, { ok: false, error: 'Registration session is invalid or expired.' });
    const proof = data.payment_proof && typeof data.payment_proof === 'object' ? data.payment_proof : {};
    const mimeType = String(proof.mime_type || '');
    const encoded = String(proof.data || '');
    if (!/^image\/(jpeg|png|webp)$/.test(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return response(400, { ok: false, error: 'A valid JPG, PNG or WebP payment screenshot is required.' });
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 2100000) {
      return response(413, { ok: false, error: 'The payment screenshot must be smaller than 2 MB.' });
    }
    const receivedAt = new Date().toISOString();
    await connectBlobs(event);
    await savePaymentProof(registration.registration_id, {
      mime_type: mimeType,
      data: encoded,
      original_name: String(proof.original_name || 'payment-proof').slice(0, 120),
      received_at: receivedAt
    });
    const proofToken = signRegistration({
      registration_id: registration.registration_id,
      purpose: 'payment_proof'
    }, process.env.WORKSHOP_SIGNING_SECRET || '');
    const headers = headersFor(event);
    const proofUrl = `https://${headers.host}/.netlify/functions/workshop-payment-proof?token=${encodeURIComponent(proofToken)}`;
    const payload = {
      event_type: 'bank_transfer_submitted', registration_id: registration.registration_id,
      email: registration.email, phone: registration.phone,
      workshop_name: WORKSHOP_NAME, workshop_date: WORKSHOP_DATE, attendance_type: attendanceType,
      ...orderValues(data.add_on_selected), payment_status: 'Unpaid', payment_method: 'bank_transfer',
      registration_status: 'Payment Pending', payment_proof_url: proofUrl,
      payment_proof_received_at: receivedAt
    };
    await postWebhook('HIGHLEVEL_BANK_TRANSFER_WEBHOOK_URL', highLevelPayload(payload));
    await saveRegistration(registration.registration_id, { ...registration, ...payload });
    return response(202, { ok: true, registration_id: registration.registration_id, payment_status: 'Unpaid' });
  } catch (error) {
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'Bank-transfer submission could not be recorded.' });
  }
};
