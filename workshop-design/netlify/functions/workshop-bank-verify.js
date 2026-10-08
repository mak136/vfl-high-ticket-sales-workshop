'use strict';

const crypto = require('node:crypto');
const {
  WORKSHOP_DATE, WORKSHOP_NAME, getPaymentProof, getRegistration, headersFor, highLevelPayload,
  issueTicket, parseJson, postWebhook, response, saveRegistration
} = require('./workshop-shared.js');

function authorized(event) {
  const configured = process.env.MANUAL_PAYMENT_VERIFY_SECRET || '';
  const supplied = (headersFor(event).authorization || '').replace(/^Bearer\s+/i, '');
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  if (!authorized(event)) return response(401, { ok: false, error: 'Unauthorized.' });
  try {
    const data = parseJson(event, 4000);
    const registrationId = String(data.registration_id || '').trim();
    const registration = await getRegistration(registrationId);
    const proof = registrationId ? await getPaymentProof(registrationId) : null;
    if (!registration || !proof || registration.payment_method !== 'bank_transfer') {
      return response(404, { ok: false, error: 'A pending bank-transfer registration was not found.' });
    }
    if (registration.payment_status === 'Paid' && registration.ticket_id) {
      return response(200, { ok: true, duplicate: true, ticket_id: registration.ticket_id, ticket_url: registration.ticket_url });
    }
    const verifiedAt = new Date().toISOString();
    const amount = Number(registration.total_order_value || 0);
    const ticket = await issueTicket(registration, {
      transaction_id: String(data.bank_reference || '').trim(), amount_paid: amount,
      currency: 'PKR', payment_method: 'bank_transfer', verified_at: verifiedAt
    });
    const paidPayload = {
      event_type: 'payment_verified', registration_id: registrationId,
      email: registration.email, phone: registration.phone,
      first_name: registration.first_name, last_name: registration.last_name,
      workshop_name: registration.workshop_name || WORKSHOP_NAME,
      workshop_date: registration.workshop_date || WORKSHOP_DATE,
      attendance_type: registration.attendance_type, ticket_type: registration.ticket_type,
      base_ticket_amount: registration.base_ticket_amount, add_on_selected: registration.add_on_selected,
      amount_paid: amount, total_order_value: amount, currency: 'PKR', payment_status: 'Paid',
      payment_method: 'bank_transfer', verified_payment_timestamp: verifiedAt,
      registration_status: 'Paid / Registered', ticket_id: ticket.ticket_id, ticket_url: ticket.ticket_url
    };
    await postWebhook('HIGHLEVEL_PAID_WEBHOOK_URL', highLevelPayload(paidPayload));
    await saveRegistration(registrationId, { ...registration, ...paidPayload });
    return response(200, { ok: true, duplicate: false, ticket_id: ticket.ticket_id, ticket_url: ticket.ticket_url });
  } catch (error) {
    return response(error.statusCode || 502, { ok: false, error: error.statusCode ? error.message : 'Manual payment verification failed.' });
  }
};
