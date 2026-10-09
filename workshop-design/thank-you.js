(function () {
  'use strict';
  const PIXEL_ID = '2114875266078656';
  const params = new URLSearchParams(location.search);
  const requestedState = params.get('payment') || 'success';
  const basketId = params.get('basket_id') || '';
  const els = Object.fromEntries(['result-kicker','result-title','result-summary','registration-id','amount-row','amount-paid','attendance-row','attendance-type','ticket-row','ticket-id','primary-action','fine-print'].map(id => [id, document.getElementById(id)]));

  window.fbq = window.fbq || function () { (window.fbq.q = window.fbq.q || []).push(arguments); };
  if (!window.fbq.loaded) {
    window.fbq.loaded = true; window.fbq.version = '2.0';
    const pixel = document.createElement('script'); pixel.async = true; pixel.src = 'https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(pixel);
    window.fbq('init', PIXEL_ID); window.fbq('track', 'PageView');
  }

  function setState(state, data = {}) {
    document.body.dataset.state = state;
    els['registration-id'].textContent = data.registration_id || basketId || 'Available in your confirmation email';
    if (state === 'failed') {
      els['result-kicker'].textContent = 'PAYMENT NOT COMPLETED';
      els['result-title'].innerHTML = 'Your registration<br><em>is still saved.</em>';
      els['result-summary'].textContent = 'The payment did not complete. You can return to checkout and try again without submitting a new registration.';
      els['primary-action'].innerHTML = 'Try Payment Again <span>↗</span>'; els['primary-action'].href = '/#registration';
      els['fine-print'].textContent = 'No ticket has been issued and no payment has been recorded.';
      return;
    }
    if (state === 'pending') {
      els['result-kicker'].textContent = 'PAYMENT PROOF RECEIVED';
      els['result-title'].innerHTML = 'We have your<br><em>payment proof.</em>';
      els['result-summary'].textContent = 'Our team will review your bank transfer. Verification can take up to 24 hours, and your seat is confirmed only after approval.';
      els['primary-action'].innerHTML = 'Return to Workshop <span>↗</span>'; els['primary-action'].href = '/';
      els['fine-print'].textContent = 'Your ticket will be sent by email after the payment is manually verified.';
      return;
    }
    if (state === 'paid') {
      els['result-kicker'].textContent = 'PAYMENT CONFIRMED';
      els['result-title'].innerHTML = 'Your seat<br><em>is confirmed.</em>';
      els['result-summary'].textContent = 'Your payment has been verified securely. Your confirmation and ticket have also been sent by email.';
      els['amount-row'].hidden = false; els['amount-paid'].textContent = `${data.currency || 'PKR'} ${Number(data.amount_paid || 0).toLocaleString('en-PK')}`;
      els['attendance-row'].hidden = false; els['attendance-type'].textContent = data.attendance_type === 'online' ? 'Live online' : 'Karachi in person';
      els['ticket-row'].hidden = false; els['ticket-id'].textContent = data.ticket_id;
      try { const ticket = new URL(data.ticket_url, location.origin); if (ticket.origin === location.origin && ticket.pathname === '/.netlify/functions/workshop-ticket') els['primary-action'].href = ticket.href; } catch (_) { /* Keep safe fallback. */ }
      els['primary-action'].innerHTML = 'View My Ticket <span>↗</span>';
      els['fine-print'].textContent = 'Keep your ticket link private and bring it with you to the workshop.';
      const eventKey = `ri_meta_purchase_${data.ticket_id}`;
      try {
        if (!localStorage.getItem(eventKey)) {
          window.fbq('track', 'Purchase', { value: Number(data.amount_paid), currency: 'PKR' });
          localStorage.setItem(eventKey, '1');
        }
      } catch (_) { /* Tracking must not affect access to the ticket. */ }
    }
  }

  async function verifyPayment() {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem('ri_workshop_registration') || 'null'); } catch (_) { saved = null; }
    if (!saved || !saved.registrationToken || (basketId && saved.registrationId !== basketId)) return;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const response = await fetch('/.netlify/functions/workshop-payment-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ registration_token: saved.registrationToken }) });
        const result = await response.json();
        if (response.ok && result.paid) { setState('paid', result); return; }
      } catch (_) { /* Retry briefly while the callback arrives. */ }
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    els['result-summary'].textContent = 'Your payment is still being verified securely. Your ticket will arrive by email after confirmation.';
    els['fine-print'].textContent = 'You may close this page. If you paid successfully, no further action is required.';
  }

  if (requestedState === 'failed') setState('failed');
  else if (requestedState === 'bank-pending') setState('pending');
  else { setState('verifying'); verifyPayment(); }
}());

