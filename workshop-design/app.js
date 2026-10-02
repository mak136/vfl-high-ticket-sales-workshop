const TRACKING_CONFIG = window.WORKSHOP_ANALYTICS_CONFIG || {};
const analytics = window.workshopAnalytics || {
  trackEvent: () => false,
  oncePerSession: () => false,
  submitContact: async () => false,
  checkoutUrl: url => url
};
const WORKSHOP_CONFIG = Object.freeze({
  currency: TRACKING_CONFIG.CURRENCY || 'PKR',
  basePrice: TRACKING_CONFIG.TICKET_PRICE || 5000,
  implementationPack: Object.freeze({
    price: TRACKING_CONFIG.ORDER_BUMP_PRICE || 5000,
    title: 'Add the Workshop Implementation Pack',
    description: 'Add the working frameworks, worksheets, and post-workshop group implementation session.',
    status: 'Final contents will be confirmed before payment opens.'
  })
});

const money = value => `${WORKSHOP_CONFIG.currency} ${value.toLocaleString('en-PK')}`;
const checkoutState = { format: 'online', implementationPack: false };

const diagnoses = {
  think: ['What is the buyer still unsure about?', 'The offer may be clear, but the outcome, risk, or decision itself may not be. Another follow-up won’t tell you which.'],
  price: ['Was the value clear before the price?', 'Price may be the real constraint. Or the buyer may not yet see how the offer helps their business. Diagnose the hesitation before discounting.'],
  proposal: ['Did you agree what the proposal would resolve?', 'A proposal is useful when it supports a known decision. Without that agreement, “send it over” can leave you both with a different idea of what happens next.'],
  partner: ['Did you understand who makes the decision?', 'Another decision-maker may need to be involved. Discovering that early helps you understand their criteria and plan a next step together.']
};

document.querySelectorAll('[data-objection]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-objection]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  const [title, copy] = diagnoses[button.dataset.objection];
  document.getElementById('diagnosis-title').textContent = title;
  document.getElementById('diagnosis-copy').textContent = copy;
}));

function formatName(format) {
  return format === 'online' ? 'Live online' : 'Live in Karachi';
}

function updateCheckoutSummary() {
  const name = formatName(checkoutState.format);
  const total = WORKSHOP_CONFIG.basePrice + (checkoutState.implementationPack ? WORKSHOP_CONFIG.implementationPack.price : 0);
  document.getElementById('order-format').textContent = `${name} · 1 attendee`;
  document.getElementById('preview-format').textContent = name;
  document.getElementById('order-total').textContent = money(total);
  document.getElementById('payment-selection').textContent = `${name} · ${checkoutState.implementationPack ? 'workshop + Implementation Pack' : 'workshop only'} · ${money(total)}`;
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
  if (changed) analytics.trackEvent('attendance_selected', { attendance_type: format, page_section: 'tickets' });
}

document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change', () => selectFormat(input.value)));
document.querySelectorAll('[data-format-select]').forEach(button => button.addEventListener('click', () => selectFormat(button.dataset.formatSelect)));

const bump = document.getElementById('implementation-pack');
document.getElementById('bump-title').textContent = WORKSHOP_CONFIG.implementationPack.title;
document.getElementById('bump-description').textContent = WORKSHOP_CONFIG.implementationPack.description;
document.getElementById('bump-status').textContent = WORKSHOP_CONFIG.implementationPack.status;
bump.addEventListener('change', () => {
  checkoutState.implementationPack = bump.checked;
  updateCheckoutSummary();
  if (bump.checked) analytics.trackEvent('order_bump_selected', {
    bump_value: WORKSHOP_CONFIG.implementationPack.price,
    currency: WORKSHOP_CONFIG.currency,
    product: 'workshop_implementation_pack'
  });
});

const attendeeStage = document.getElementById('attendee-stage');
const checkoutStage = document.getElementById('checkout-stage');
const seatForm = document.getElementById('seat-form');
let contactSubmission = Promise.resolve(false);

const turnstileSiteKey = TRACKING_CONFIG.TURNSTILE_SITE_KEY;
const reserveButton = seatForm.querySelector('button[type="submit"]');
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
      callback: token => { turnstileToken.value = token; reserveButton.disabled = false; },
      'expired-callback': () => { turnstileToken.value = ''; reserveButton.disabled = true; },
      'error-callback': () => { turnstileToken.value = ''; reserveButton.disabled = true; }
    });
  };
  turnstileScript.onerror = () => { reserveButton.disabled = true; };
  document.head.appendChild(turnstileScript);
}

seatForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!seatForm.reportValidity()) return;
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
      reserveButton.disabled = true;
    }
    return result;
  });
  attendeeStage.hidden = true;
  checkoutStage.hidden = false;
  analytics.oncePerSession('order_bump_viewed', 'order_bump_viewed', {
    product: TRACKING_CONFIG.PRODUCT_ID || 'high_ticket_sales_workshop',
    value: WORKSHOP_CONFIG.implementationPack.price,
    currency: WORKSHOP_CONFIG.currency,
    page_section: 'checkout'
  });
  updateCheckoutSummary();
  checkoutStage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
});

document.getElementById('edit-details').addEventListener('click', () => {
  checkoutStage.hidden = true;
  attendeeStage.hidden = false;
  document.getElementById('name').focus();
});

document.getElementById('payment-button').addEventListener('click', async () => {
  const button = document.getElementById('payment-button');
  const total = WORKSHOP_CONFIG.basePrice + (checkoutState.implementationPack ? WORKSHOP_CONFIG.implementationPack.price : 0);
  const checkoutUrl = TRACKING_CONFIG.CHECKOUT_URL;
  if (checkoutUrl) {
    button.disabled = true;
    analytics.trackEvent('checkout_started', {
      value: total,
      currency: WORKSHOP_CONFIG.currency,
      product: TRACKING_CONFIG.PRODUCT_ID || 'high_ticket_sales_workshop',
      attendance_type: checkoutState.format,
      order_bump: checkoutState.implementationPack
    });
    const fullName = document.getElementById('name').value.trim();
    const nameParts = fullName.split(/\s+/);
    const firstName = nameParts.shift() || '';
    const lastName = nameParts.join(' ');
    // Turnstile tokens are single-use. The contact is submitted once at the attendee step;
    // checkout_started remains an analytics event and does not resubmit the same token.
    await Promise.race([contactSubmission, new Promise(resolve => setTimeout(resolve, 900))]);
    window.location.assign(analytics.checkoutUrl(checkoutUrl, {
      ...analytics.attribution
    }, {
      attendance_type: checkoutState.format,
      product: TRACKING_CONFIG.PRODUCT_ID || 'high_ticket_sales_workshop',
      value: total,
      currency: WORKSHOP_CONFIG.currency,
      order_bump: checkoutState.implementationPack
    }));
    return;
  }
  const preview = document.getElementById('payment-preview');
  preview.hidden = false;
  preview.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  // Payment provider integration point:
  // send the attendee details and checkoutState to the PayFast endpoint here.
});

const mobileSeat = document.getElementById('mobile-seat');
if ('IntersectionObserver' in window) {
  let heroVisible = true;
  let registrationVisible = false;
  const updateMobileSeat = () => mobileSeat.classList.toggle('hidden', heroVisible || registrationVisible);
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.target.classList.contains('hero')) heroVisible = entry.isIntersecting;
      if (entry.target.id === 'registration') registrationVisible = entry.isIntersecting;
    });
    updateMobileSeat();
  }, { threshold: .08 });
  observer.observe(document.querySelector('.hero'));
  observer.observe(document.getElementById('registration'));
  updateMobileSeat();
}

updateCheckoutSummary();

// Motion stays tied to real moments: the stalled-call sheet arriving, proof
// surfaces entering the reading path, and a visible response to a format choice.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('motion-ready');
}
