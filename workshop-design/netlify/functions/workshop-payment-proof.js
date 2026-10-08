'use strict';

const { getPaymentProof, response, verifyRegistration } = require('./workshop-shared.js');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') return response(405, { ok: false, error: 'Method not allowed.' });
  try {
    const token = event.queryStringParameters && event.queryStringParameters.token;
    const access = verifyRegistration(token, process.env.WORKSHOP_SIGNING_SECRET || '', 30 * 24 * 60 * 60 * 1000);
    if (!access || access.purpose !== 'payment_proof' || !access.registration_id) {
      return response(401, { ok: false, error: 'This payment-proof link is invalid or expired.' });
    }
    const proof = await getPaymentProof(access.registration_id);
    if (!proof || !proof.data || !proof.mime_type) return response(404, { ok: false, error: 'Payment proof was not found.' });
    const extension = proof.mime_type === 'image/png' ? 'png' : proof.mime_type === 'image/webp' ? 'webp' : 'jpg';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': proof.mime_type,
        'Content-Disposition': `inline; filename="payment-proof-${access.registration_id}.${extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      },
      isBase64Encoded: true,
      body: proof.data
    };
  } catch (_) {
    return response(502, { ok: false, error: 'Payment proof could not be loaded.' });
  }
};
