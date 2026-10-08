const TRACKING_CONFIG = window.WORKSHOP_ANALYTICS_CONFIG || {};
const analytics = window.workshopAnalytics || {
  trackEvent: () => false,
  oncePerSession: () => false,
  submitContact: async () => ({ ok: false }),
  submitCheckoutStart: async () => false,
  submitBankTransfer: async () => ({ ok: false }),
  checkoutUrl: url => url
};
const WORKSHOP_CONFIG = Object.freeze({
  currency: TRACKING_CONFIG.CURRENCY || 'PKR',
  basePrice: TRACKING_CONFIG.TICKET_PRICE || 5000
});

const money = value => `${WORKSHOP_CONFIG.currency} ${value.toLocaleString('en-PK')}`;
const checkoutState = { format: 'online' };
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

function playMotion(element, keyframes, options = {}) {
  if (!element || motionPreference.matches || typeof element.animate !== 'function') return;
  element.animate(keyframes, {
    duration: 220,
    easing: 'cubic-bezier(.16,1,.3,1)',
    ...options
  });
}

function acknowledgeSelection(element) {
  playMotion(element, [
    { transform: 'scale(.975)' },
    { transform: 'scale(1)' }
  ], { duration: 180 });
}

function formatName(format) {
  return format === 'online' ? 'Live online' : 'Karachi in person';
}

function updateCheckoutSummary() {
  const name = formatName(checkoutState.format);
  document.getElementById('order-format').textContent = `${name} · 1 attendee`;
  document.getElementById('preview-format').textContent = name;
  document.getElementById('order-total').textContent = money(WORKSHOP_CONFIG.basePrice);
  document.getElementById('payment-selection').textContent = `${name} · ${money(WORKSHOP_CONFIG.basePrice)}`;
  document.getElementById('payment-preview').hidden = true;
  document.querySelectorAll('[data-format-select]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.formatSelect === checkoutState.format));
  });
}

function selectFormat(format) {
  const changed = checkoutState.format !== format;
  checkoutState.format = format;
  const radio = document.querySelector(`input[name="format"][value="${format}"]`);
  if (radio) radio.checked = true;
  updateCheckoutSummary();
  if (changed) {
    acknowledgeSelection(document.querySelector(`[data-format-select="${format}"]`));
    acknowledgeSelection(document.querySelector(`input[name="format"][value="${format}"] + span`));
    playMotion(document.querySelector('.order-line'), [
      { opacity: .62, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ]);
    analytics.trackEvent('attendance_selected', { attendance_type: format, page_section: 'tickets' });
  }
}

document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change', () => selectFormat(input.value)));
document.querySelectorAll('[data-format-select]').forEach(button => button.addEventListener('click', () => selectFormat(button.dataset.formatSelect)));

const attendeeStage = document.getElementById('attendee-stage');
const checkoutStage = document.getElementById('checkout-stage');
const seatForm = document.getElementById('seat-form');
let contactSubmission = Promise.resolve({ ok: false });

function currentOrder() {
  return {
    attendance_type: checkoutState.format,
    product: TRACKING_CONFIG.PRODUCT_ID || 'high_ticket_sales_workshop',
    value: WORKSHOP_CONFIG.basePrice,
    currency: WORKSHOP_CONFIG.currency,
    order_bump: false
  };
}

async function savedRegistration() {
  return Promise.race([
    contactSubmission,
    new Promise(resolve => setTimeout(() => resolve({ ok: false }), 5000))
  ]);
}

async function recordCheckout(button) {
  button.disabled = true;
  const registration = await savedRegistration();
  if (!registration.ok) {
    button.disabled = false;
    document.getElementById('checkout-disclosure').textContent = 'We could not save your registration. Please edit your details and try again.';
    return null;
  }
  const recorded = await analytics.submitCheckoutStart(registration, currentOrder());
  if (!recorded) {
    button.disabled = false;
    document.getElementById('checkout-disclosure').textContent = 'Checkout is temporarily unavailable. Please try again.';
    return null;
  }
  document.getElementById('bank-registration-id').textContent = registration.registrationId;
  return registration;
}

function imageProof(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP screenshot.'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error('Choose an image smaller than 8 MB.'));
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', .82);
      const base64 = dataUrl.split(',')[1] || '';
      if (!base64 || base64.length > 2_800_000) return reject(new Error('The screenshot is still too large. Please crop it and try again.'));
      resolve({ mime_type: 'image/jpeg', data: base64, original_name: file.name.slice(0, 120) });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('We could not read that image. Please choose another screenshot.'));
    };
    image.src = objectUrl;
  });
}

const turnstileSiteKey = TRACKING_CONFIG.TURNSTILE_SITE_KEY;
const reserveButton = seatForm.querySelector('button[type="submit"]');
const registrationStatus = document.createElement('p');
registrationStatus.id = 'registration-status';
registrationStatus.className = 'registration-status';
registrationStatus.setAttribute('role', 'status');
registrationStatus.setAttribute('aria-live', 'polite');
reserveButton.after(registrationStatus);
let registrationSaving = false;
let turnstileWidgetId;
let turnstileBox = document.getElementById('turnstile-box');
let turnstileToken = document.getElementById('turnstile-token');
if (!turnstileBox) {
  turnstileBox = document.createElement('div');
  turnstileBox.id = 'turnstile-box';
  reserveButton.before(turnstileBox);
}
if (!turnstileToken) {
  turnstileToken = document.createElement('input');
  turnstileToken.id = 'turnstile-token';
  turnstileToken.type = 'hidden';
  seatForm.appendChild(turnstileToken);
}
if (turnstileSiteKey) {
  turnstileBox.hidden = false;
  reserveButton.disabled = true;
  const turnstileScript = document.createElement('script');
  turnstileScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  turnstileScript.async = true;
  turnstileScript.defer = true;
  turnstileScript.onload = () => {
    if (!window.turnstile) return;
    turnstileWidgetId = window.turnstile.render(turnstileBox, {
      sitekey: turnstileSiteKey,
      action: 'registration',
      callback: token => { turnstileToken.value = token; reserveButton.disabled = registrationSaving; },
      'expired-callback': () => { turnstileToken.value = ''; reserveButton.disabled = true; },
      'error-callback': () => { turnstileToken.value = ''; reserveButton.disabled = true; }
    });
  };
  turnstileScript.onerror = () => { reserveButton.disabled = true; };
  document.head.appendChild(turnstileScript);
}

seatForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!seatForm.reportValidity()) return;
  if (registrationSaving) return;
  registrationSaving = true;
  reserveButton.disabled = true;
  reserveButton.setAttribute('aria-busy', 'true');
  registrationStatus.textContent = 'Saving your registration…';
  const fullName = document.getElementById('name').value.trim();
  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts.shift() || '';
  const lastName = nameParts.join(' ');
  contactSubmission = analytics.submitContact({
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    attendance_type: checkoutState.format,
    registration_status: 'Landing Page Lead',
    payment_status: 'Unpaid',
    payment_amount: WORKSHOP_CONFIG.basePrice,
    order_bump: false
  }).then(result => {
    // Siteverify consumes a token even if the CRM request later fails.
    if (turnstileSiteKey && window.turnstile && turnstileWidgetId !== undefined) {
      turnstileToken.value = '';
      window.turnstile.reset(turnstileWidgetId);
    }
    return result;
  });
  const registration = await contactSubmission;
  registrationSaving = false;
  reserveButton.removeAttribute('aria-busy');
  if (!registration.ok) {
    registrationStatus.textContent = registration.error || 'We could not save your registration. Please check your details and try again.';
    reserveButton.disabled = Boolean(turnstileSiteKey && !turnstileToken.value);
    document.getElementById('name').focus();
    return;
  }
  registrationStatus.textContent = '';
  attendeeStage.hidden = true;
  checkoutStage.hidden = false;
  playMotion(checkoutStage, [
    { opacity: .35, transform: 'translateY(10px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration: 320 });
  updateCheckoutSummary();
  checkoutStage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
});

document.getElementById('edit-details').addEventListener('click', () => {
  checkoutStage.hidden = true;
  attendeeStage.hidden = false;
  playMotion(attendeeStage, [
    { opacity: .45, transform: 'translateY(-6px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ]);
  document.getElementById('name').focus();
});

document.getElementById('payment-button').addEventListener('click', async () => {
  const button = document.getElementById('payment-button');
  const checkoutUrl = TRACKING_CONFIG.CHECKOUT_URL;
  const registration = await recordCheckout(button);
  if (!registration) return;
  const order = currentOrder();
  analytics.trackEvent('checkout_started', order);
  if (checkoutUrl) {
    window.location.assign(analytics.checkoutUrl(checkoutUrl, order));
    return;
  }
  button.disabled = false;
  const preview = document.getElementById('payment-preview');
  preview.hidden = false;
  preview.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  // Payment provider integration point:
  // send the attendee details and checkoutState to the PayFast endpoint here.
});

const bankPanel = document.getElementById('bank-transfer-panel');
const bankButton = document.getElementById('bank-transfer-button');
const proofInput = document.getElementById('payment-proof');
const proofSubmit = document.getElementById('submit-bank-transfer');
const bankStatus = document.getElementById('bank-transfer-status');
const bankReady = Boolean(
  TRACKING_CONFIG.BANK_TRANSFER_READY &&
  TRACKING_CONFIG.BANK_IBAN &&
  TRACKING_CONFIG.BANK_ACCOUNT_NUMBER
);

document.getElementById('bank-name').textContent = TRACKING_CONFIG.BANK_NAME || 'JS Bank';
document.getElementById('bank-account-title').textContent = TRACKING_CONFIG.BANK_ACCOUNT_TITLE || 'Revenue Incarnate';
document.getElementById('bank-iban').textContent = TRACKING_CONFIG.BANK_IBAN || 'To be added';
document.getElementById('bank-account-number').textContent = TRACKING_CONFIG.BANK_ACCOUNT_NUMBER || 'To be added';
proofInput.disabled = !bankReady;

bankButton.addEventListener('click', async () => {
  const expanded = bankButton.getAttribute('aria-expanded') === 'true';
  bankButton.setAttribute('aria-expanded', String(!expanded));
  bankPanel.hidden = expanded;
  if (expanded) return;
  analytics.trackEvent('payment_instructions_viewed', { payment_method: 'bank_transfer' });
  playMotion(bankPanel, [
    { opacity: .45, transform: 'translateY(7px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ]);
  const registration = await savedRegistration();
  if (registration.ok) document.getElementById('bank-registration-id').textContent = registration.registrationId;
});

proofInput.addEventListener('change', () => {
  proofSubmit.disabled = !bankReady || !proofInput.files.length;
  if (proofInput.files.length) bankStatus.textContent = 'Screenshot selected. Submit it for manual verification.';
});

proofSubmit.addEventListener('click', async () => {
  if (!bankReady || !proofInput.files.length) return;
  proofSubmit.disabled = true;
  bankStatus.textContent = 'Uploading your payment proof…';
  try {
    const registration = await recordCheckout(proofSubmit);
    if (!registration) return;
    const proof = await imageProof(proofInput.files[0]);
    const result = await analytics.submitBankTransfer(registration, currentOrder(), proof);
    if (!result.ok) throw new Error('Your payment proof could not be submitted. Please try again.');
    bankStatus.textContent = `Payment proof received for ${result.registrationId}. Verification can take up to 24 hours.`;
    proofInput.disabled = true;
    proofSubmit.hidden = true;
    document.getElementById('edit-details').hidden = true;
  } catch (error) {
    proofSubmit.disabled = false;
    bankStatus.textContent = error.message || 'Your payment proof could not be submitted. Please try again.';
  }
});

const mobileSeat = document.getElementById('mobile-seat');
if ('IntersectionObserver' in window) {
  let heroVisible = true;
  let registrationVisible = false;
  let footerVisible = false;
  const updateMobileSeat = () => mobileSeat.classList.toggle('hidden', heroVisible || registrationVisible || footerVisible);
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.target.classList.contains('hero')) heroVisible = entry.isIntersecting;
      if (entry.target.id === 'registration') registrationVisible = entry.isIntersecting;
      if (entry.target.id === 'footer') footerVisible = entry.isIntersecting;
    });
    updateMobileSeat();
  }, { threshold: .08 });
  observer.observe(document.querySelector('.hero'));
  observer.observe(document.getElementById('registration'));
  observer.observe(document.getElementById('footer'));
  updateMobileSeat();
}

updateCheckoutSummary();

// Motion stays tied to real moments: the stalled-call sheet arriving, proof
// surfaces entering the reading path, and a visible response to a format choice.
if (!motionPreference.matches) {
  document.documentElement.classList.add('motion-ready');
}

// A few section-level reveals establish reading rhythm without turning every
// paragraph into an animation. Content remains visible unless JavaScript has
// deliberately prepared an offscreen element for its one-time entrance.
if ('IntersectionObserver' in window && !motionPreference.matches) {
  const revealTargets = [
    document.querySelector('.recognition-copy'),
    document.querySelector('#method > .section-heading'),
    document.querySelector('.experience-grid'),
    document.querySelector('.community-proof-heading'),
    document.getElementById('registration')
  ].filter(Boolean);
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: .08 });

  revealTargets.forEach(target => {
    const rect = target.getBoundingClientRect();
    if (rect.top < window.innerHeight * .92) {
      target.classList.add('is-revealed');
      return;
    }
    target.classList.add('motion-reveal');
    revealObserver.observe(target);
  });
}

// As the conversation sheet moves through the viewport, let its quote drift
// slightly in response. This keeps the visual tied to the act of revisiting a
// sales conversation, without a constant shake or work while it is offscreen.
const quoteArt = document.querySelector('.quote-art');
if (quoteArt && 'IntersectionObserver' in window && !motionPreference.matches) {
  let quoteInView = false;
  let quoteFrame = 0;
  const resetQuoteDrift = () => {
    quoteArt.style.removeProperty('--quote-drift-y');
    quoteArt.style.removeProperty('--quote-drift-angle');
  };
  const updateQuoteDrift = () => {
    quoteFrame = 0;
    if (!quoteInView || motionPreference.matches) return;
    const rect = quoteArt.getBoundingClientRect();
    const offset = (window.innerHeight * 0.5 - (rect.top + rect.height * 0.5)) / (window.innerHeight * 0.8);
    const progress = Math.max(-1, Math.min(1, offset));
    const isPhone = matchMedia('(max-width: 767px)').matches;
    quoteArt.style.setProperty('--quote-drift-y', `${(progress * (isPhone ? -3 : -5)).toFixed(2)}px`);
    quoteArt.style.setProperty('--quote-drift-angle', `${(progress * (isPhone ? .25 : .45)).toFixed(2)}deg`);
  };
  const scheduleQuoteDrift = () => {
    if (!quoteFrame && quoteInView && !motionPreference.matches) {
      quoteFrame = requestAnimationFrame(updateQuoteDrift);
    }
  };
  const quoteObserver = new IntersectionObserver(([entry]) => {
    quoteInView = entry.isIntersecting;
    quoteArt.style.willChange = quoteInView && !motionPreference.matches ? 'translate, rotate' : '';
    if (quoteInView && !motionPreference.matches) scheduleQuoteDrift();
    else resetQuoteDrift();
  }, { rootMargin: '80px 0px' });
  quoteObserver.observe(quoteArt);
  window.addEventListener('scroll', scheduleQuoteDrift, { passive: true });
  window.addEventListener('resize', scheduleQuoteDrift, { passive: true });
  motionPreference.addEventListener('change', event => {
    if (event.matches) {
      quoteArt.style.willChange = '';
      resetQuoteDrift();
    } else {
      scheduleQuoteDrift();
    }
  });
}
