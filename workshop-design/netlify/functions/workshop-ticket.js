'use strict';

const { connectBlobs, getTicket, verifyRegistration } = require('./workshop-shared.js');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function page(statusCode, title, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    },
    body: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>html{font-family:Arial,sans-serif;background:#171815;color:#f2f0e8}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;box-sizing:border-box}.ticket{width:min(100%,520px);border:1px solid #55584e;background:#20211d;padding:28px;box-sizing:border-box}.brand{font-family:Georgia,serif;font-size:20px}.eyebrow{margin-top:34px;color:#ff8c4f;font-size:11px;letter-spacing:.12em}.name{font-size:32px;margin:9px 0}.meta{color:#b7b8ae;line-height:1.6}.id{margin-top:28px;border-top:1px solid #55584e;padding-top:20px;font-family:monospace;font-size:16px;overflow-wrap:anywhere}.status{display:inline-block;margin-top:16px;padding:7px 10px;background:#e7eadf;color:#171815;font-size:11px;font-weight:700;text-transform:uppercase}</style><body><main class="ticket">${body}</main></body></html>`
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') return page(405, 'Ticket unavailable', '<p>Method not allowed.</p>');
  const token = event.queryStringParameters && event.queryStringParameters.token;
  const signed = verifyRegistration(token, process.env.WORKSHOP_SIGNING_SECRET || '', 370 * 24 * 60 * 60 * 1000);
  if (!signed || signed.purpose !== 'workshop_ticket') return page(404, 'Ticket unavailable', '<p>This ticket link is invalid or expired.</p>');
  await connectBlobs(event);
  const ticket = await getTicket(signed.registration_id);
  if (!ticket || ticket.ticket_id !== signed.ticket_id || ticket.status !== 'active') return page(404, 'Ticket unavailable', '<p>This ticket is not active.</p>');
  const attendee = `${ticket.first_name || ''} ${ticket.last_name || ''}`.trim();
  const format = ticket.attendance_type === 'online' ? 'Live online' : 'Karachi in person';
  return page(200, 'VFL Workshop Ticket', `<div class="brand">Revenue Incarnate</div><div class="eyebrow">HIGH-TICKET SALES WORKSHOP · 25 OCTOBER 2026</div><h1 class="name">${escapeHtml(attendee)}</h1><p class="meta">${escapeHtml(format)}<br>Payment verified</p><div class="id">${escapeHtml(ticket.ticket_id)}</div><span class="status">Valid ticket</span>`);
};
