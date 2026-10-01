const WORKSHOP_CONFIG = Object.freeze({
  currency: 'PKR',
  basePrice: 5000,
  implementationPack: Object.freeze({
    price: 5000,
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
  checkoutState.format = format;
  const radio = document.querySelector(`input[name="format"][value="${format}"]`);
  if (radio) radio.checked = true;
  updateCheckoutSummary();
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
});

const attendeeStage = document.getElementById('attendee-stage');
const checkoutStage = document.getElementById('checkout-stage');
const seatForm = document.getElementById('seat-form');

seatForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!seatForm.reportValidity()) return;
  attendeeStage.hidden = true;
  checkoutStage.hidden = false;
  updateCheckoutSummary();
  checkoutStage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
});

document.getElementById('edit-details').addEventListener('click', () => {
  checkoutStage.hidden = true;
  attendeeStage.hidden = false;
  document.getElementById('name').focus();
});

document.getElementById('payment-button').addEventListener('click', () => {
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
