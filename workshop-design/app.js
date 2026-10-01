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
function updateTicket(format) {
  const online = format === 'online';
  const name = online ? 'Live online' : 'Karachi';
  document.querySelector(`input[name="format"][value="${format}"]`).checked = true;
  document.getElementById('order-format').textContent = `${name} · 1 attendee`;
  document.getElementById('order-price').textContent = online ? 'Pricing soon' : 'Pricing soon';
  document.getElementById('preview-format').textContent = name;
  document.getElementById('payment-preview').hidden = true;
}
document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change', () => updateTicket(input.value)));
document.querySelectorAll('[data-format-link]').forEach(link => link.addEventListener('click', () => updateTicket(link.dataset.formatLink)));
document.getElementById('seat-form').addEventListener('submit', event => {
  event.preventDefault();
  const preview = document.getElementById('payment-preview');
  preview.hidden = false;
  preview.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'nearest'});
});
const mobileSeat = document.getElementById('mobile-seat');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => mobileSeat.classList.toggle('hidden', entry.isIntersecting));
  }, {threshold: .08});
  observer.observe(document.getElementById('registration'));
}
