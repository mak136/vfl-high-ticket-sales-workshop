'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ATTRIBUTION_KEY,
  resolveAttribution,
  checkoutUrl,
  createTracker,
  inferCtaContext
} = require('../tracking.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function browserFor(search = '') {
  return {
    location: { search, href: `https://afrozesalesworkshop.netlify.app/${search}`, origin: 'https://afrozesalesworkshop.netlify.app', pathname: '/' },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    dataLayer: [],
    fetch: async () => ({ ok: true })
  };
}

test('Meta UTMs and click ID are captured on first visit', () => {
  const storage = memoryStorage();
  const attr = resolveAttribution({
    search: '?utm_source=meta&utm_medium=paid_social&utm_campaign=workshop_october&utm_content=video_a&fbclid=click-1',
    href: 'https://afrozesalesworkshop.netlify.app/?utm_source=meta',
    localStorage: storage
  });
  assert.equal(attr.utm_source, 'meta');
  assert.equal(attr.utm_campaign, 'workshop_october');
  assert.equal(attr.fbclid, 'click-1');
  assert.equal(attr.first_touch_source, 'meta');
  assert.equal(attr.first_touch_campaign, 'workshop_october');
  assert.equal(storage.getItem(ATTRIBUTION_KEY) !== null, true);
});

test('community second touch updates last touch and preserves original source', () => {
  const storage = memoryStorage();
  resolveAttribution({
    search: '?utm_source=meta&utm_medium=paid_social&utm_campaign=launch',
    href: 'https://afrozesalesworkshop.netlify.app/?utm_source=meta', localStorage: storage
  });
  const attr = resolveAttribution({
    search: '?utm_source=community&utm_medium=whatsapp&utm_campaign=workshop_october',
    href: 'https://afrozesalesworkshop.netlify.app/?utm_source=community', localStorage: storage
  });
  assert.equal(attr.first_touch_source, 'meta');
  assert.equal(attr.first_touch_campaign, 'launch');
  assert.equal(attr.last_touch_source, 'community');
  assert.equal(attr.last_touch_campaign, 'workshop_october');
  assert.equal(attr.utm_medium, 'whatsapp');
});

test('direct revisit does not overwrite last-touch attribution', () => {
  const storage = memoryStorage();
  resolveAttribution({ search: '?utm_source=instagram&utm_medium=organic&utm_campaign=october', href: 'https://afrozesalesworkshop.netlify.app/', localStorage: storage });
  const attr = resolveAttribution({ search: '', href: 'https://afrozesalesworkshop.netlify.app/', localStorage: storage });
  assert.equal(attr.last_touch_source, 'instagram');
  assert.equal(attr.last_touch_campaign, 'october');
});

test('external referral updates last touch while preserving first touch', () => {
  const storage = memoryStorage();
  resolveAttribution({ search: '?utm_source=meta&utm_campaign=launch', href: 'https://afrozesalesworkshop.netlify.app/', localStorage: storage });
  const attr = resolveAttribution({ href: 'https://afrozesalesworkshop.netlify.app/', referrer: 'https://www.instagram.com/profile/', localStorage: storage });
  assert.equal(attr.first_touch_source, 'meta');
  assert.equal(attr.last_touch_source, 'instagram.com');
});

test('unattributed first visit is recorded as direct', () => {
  const attr = resolveAttribution({ href: 'https://afrozesalesworkshop.netlify.app/', localStorage: memoryStorage() });
  assert.equal(attr.first_touch_source, 'direct');
  assert.equal(attr.last_touch_source, 'direct');
});

test('checkout URL receives attribution and attendance/order details, never contact PII', () => {
  const url = new URL(checkoutUrl('https://payments.example/checkout?keep=1', {
    utm_source: 'community', utm_campaign: 'workshop_october', fbclid: 'fb-1',
    landing_page: 'https://afrozesalesworkshop.netlify.app/', first_touch_source: 'meta',
    first_touch_campaign: 'launch', last_touch_source: 'community', last_touch_campaign: 'workshop_october'
  }, { attendance_type: 'karachi', product: 'high_ticket_sales_workshop', value: 10000, currency: 'PKR', order_bump: true }));
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(url.searchParams.get('utm_source'), 'community');
  assert.equal(url.searchParams.get('attendance_type'), 'karachi');
  assert.equal(url.searchParams.get('value'), '10000');
  assert.equal(url.searchParams.get('order_bump'), '1');
  assert.equal(url.searchParams.has('email'), false);
});

test('CTA context distinguishes offer and sticky mobile placements', () => {
  const anchor = selector => ({ closest: value => value === selector ? {} : null });
  assert.deepEqual(inferCtaContext(anchor('.offer-main')), { cta_location: 'offer', page_section: 'tickets' });
  assert.deepEqual(inferCtaContext(anchor('.mobile-seat')), { cta_location: 'sticky_mobile', page_section: 'mobile_seat' });
});

test('analytics events strip PII and server-only payment events cannot fire in the browser', () => {
  const browser = browserFor('?utm_source=meta&utm_campaign=launch');
  const tracker = createTracker({ window: browser, document: { referrer: '' }, config: { META_PIXEL_ID: '', GA4_MEASUREMENT_ID: '', GTM_CONTAINER_ID: '' } });
  assert.equal(tracker.trackEvent('workshop_cta_click', { cta_location: 'hero', email: 'private@example.com', phone: '123' }), true);
  assert.equal(browser.dataLayer.length, 1);
  assert.equal(browser.dataLayer[0].cta_location, 'hero');
  assert.equal(browser.dataLayer[0].utm_source, 'meta');
  assert.equal('email' in browser.dataLayer[0], false);
  assert.equal('phone' in browser.dataLayer[0], false);
  assert.equal(tracker.trackEvent('payment_verified', { transaction_id: 'txn-1' }), false);
  assert.equal(tracker.trackEvent('purchase', { transaction_id: 'txn-1', value: 5000 }), false);
  assert.equal(browser.dataLayer.length, 1);
});

test('contact submission posts PII only to the CRM proxy and fires contact_submitted after success', async () => {
  const browser = browserFor('?utm_source=community&utm_medium=whatsapp');
  let sent;
  browser.fetch = async (_url, options) => { sent = JSON.parse(options.body); return { ok: true }; };
  const tracker = createTracker({
    window: browser,
    document: { referrer: '' },
    config: { ...require('../tracking.js').CONFIG, HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT: '/.netlify/functions/workshop-contact' }
  });
  const ok = await tracker.submitContact({ full_name: 'Test Person', first_name: 'Test', last_name: 'Person', email: 'test@example.com', phone: '03001234567', attendance_type: 'online' });
  assert.equal(ok, true);
  assert.equal(sent.email, 'test@example.com');
  assert.equal(sent.attribution.utm_source, 'community');
  assert.equal(browser.dataLayer.at(-1).event, 'contact_submitted');
  assert.equal('email' in browser.dataLayer.at(-1), false);
});

test('contact endpoint failure is non-blocking and does not count as submitted', async () => {
  const browser = browserFor();
  browser.fetch = async () => ({ ok: false, status: 503 });
  const tracker = createTracker({
    window: browser, document: { referrer: '' },
    config: { ...require('../tracking.js').CONFIG, HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT: '/.netlify/functions/workshop-contact' }
  });
  const ok = await tracker.submitContact({ first_name: 'Test', email: 'test@example.com', phone: '03001234567', attendance_type: 'online' });
  assert.equal(ok, false);
  assert.equal(browser.dataLayer.some(event => event.event === 'contact_submitted'), false);
});

test('order-bump and manual-payment events are trackable; purchase remains server-only', () => {
  const browser = browserFor();
  const tracker = createTracker({ window: browser, document: { referrer: '' }, config: {} });
  tracker.trackEvent('order_bump_viewed', { value: 5000, currency: 'PKR' });
  tracker.trackEvent('order_bump_selected', { bump_value: 5000, currency: 'PKR' });
  tracker.trackEvent('payment_instructions_viewed', { payment_method: 'bank_transfer' });
  tracker.trackEvent('payment_proof_submitted', { payment_method: 'bank_transfer' });
  assert.deepEqual(browser.dataLayer.map(event => event.event), [
    'order_bump_viewed', 'order_bump_selected', 'payment_instructions_viewed', 'payment_proof_submitted'
  ]);
});

test('order-bump accepted and declined checkout choices remain distinguishable', () => {
  const browser = browserFor();
  const tracker = createTracker({ window: browser, document: { referrer: '' }, config: {} });
  tracker.trackEvent('checkout_started', { value: 10000, currency: 'PKR', order_bump: true });
  tracker.trackEvent('checkout_started', { value: 5000, currency: 'PKR', order_bump: false });
  assert.deepEqual(browser.dataLayer.map(event => event.order_bump), [true, false]);
});

test('actual purchase cannot be duplicated or forged by browser events', () => {
  const browser = browserFor();
  const tracker = createTracker({ window: browser, document: { referrer: '' }, config: {} });
  const purchase = { transaction_id: 'txn-123', base_value: 5000, bump_value: 0, total_value: 5000, currency: 'PKR' };
  assert.equal(tracker.trackEvent('purchase', purchase), false);
  assert.equal(tracker.trackEvent('purchase', purchase), false);
  assert.equal(browser.dataLayer.length, 0);
});
