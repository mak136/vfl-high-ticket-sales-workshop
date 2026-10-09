(function workshopTrackingBootstrap(root) {
  'use strict';

  const CONFIG = Object.freeze({
    META_PIXEL_ID: '2114875266078656',
    GA4_MEASUREMENT_ID: '',
    GTM_CONTAINER_ID: '',
    // Same-origin proxy. The HighLevel webhook URL stays in Netlify environment variables.
    HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT: '/.netlify/functions/workshop-contact',
    CHECKOUT_START_ENDPOINT: '/.netlify/functions/workshop-checkout',
    PAYFAST_START_ENDPOINT: '/.netlify/functions/workshop-payfast-start',
    BANK_TRANSFER_ENDPOINT: '/.netlify/functions/workshop-bank-transfer',
    // Public site key only. Keep the matching secret in Netlify environment variables.
    TURNSTILE_SITE_KEY: '0x4AAAAAAFQ5i_2KJPBbJH-_',
    BANK_TRANSFER_READY: true,
    BANK_NAME: 'JS Bank',
    BANK_ACCOUNT_TITLE: 'Revenue Incarnate',
    BANK_IBAN: 'PK74JSBL9132000003035020',
    BANK_ACCOUNT_NUMBER: '0003035020',
    BANK_BRANCH: 'Khadda Market Branch',
    BANK_BRANCH_CODE: '9132',
    PRODUCT_ID: 'high_ticket_sales_workshop',
    PRODUCT_NAME: 'High-Ticket Sales Workshop',
    WORKSHOP_DATE: '2026-10-25',
    CURRENCY: 'PKR',
    TICKET_PRICE: 5000,
    ORDER_BUMP_PRICE: 5000,
    ANALYTICS_DEBUG: false
  });

  const ATTRIBUTION_KEY = 'ri_workshop_attribution_v1';
  const FIRST_TOUCH_KEY = 'ri_workshop_first_touch_v1';
  const EVENT_ALLOWLIST = new Set([
    'workshop_page_view', 'workshop_cta_click', 'registration_started',
    'attendance_selected', 'contact_submitted', 'checkout_started',
    'order_bump_viewed', 'order_bump_selected',
    'payment_instructions_viewed',
    'payment_proof_submitted'
  ]);
  const SERVER_ONLY_EVENTS = new Set(['payment_verified', 'purchase']);
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const CLICK_KEYS = ['fbclid', 'gclid'];
  const ANALYTICS_ATTRIBUTION_KEYS = [
    ...UTM_KEYS, 'first_touch_source', 'first_touch_campaign',
    'last_touch_source', 'last_touch_campaign'
  ];
  const PII_KEY = /(^|_)(email|phone|mobile|name|full_name|first_name|last_name|address|payment_proof)(_|$)/i;

  function parseObject(value) {
    try { return value ? JSON.parse(value) : null; } catch (_) { return null; }
  }

  function readStorage(storage, key) {
    try { return parseObject(storage && storage.getItem(key)); } catch (_) { return null; }
  }

  function writeStorage(storage, key, value) {
    try { if (storage) storage.setItem(key, JSON.stringify(value)); } catch (_) { /* Storage can be unavailable. */ }
  }

  function safePageUrl(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch (_) { return ''; }
  }

  function safeReferrer(value) {
    return safePageUrl(value);
  }

  function sourceFor(params, referrer) {
    if (params.get('utm_source')) return params.get('utm_source').trim().toLowerCase();
    if (params.has('fbclid')) return 'meta';
    if (params.has('gclid')) return 'google';
    if (referrer) {
      try { return new URL(referrer).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { /* ignore */ }
    }
    return 'direct';
  }

  function resolveAttribution({ search = '', href = '', referrer = '', localStorage } = {}) {
    const params = new URLSearchParams(search);
    const old = readStorage(localStorage, ATTRIBUTION_KEY) || {};
    const oldFirst = readStorage(localStorage, FIRST_TOUCH_KEY) || {};
    const page = safePageUrl(href);
    const cleanReferrer = safeReferrer(referrer);
    const hasCampaign = UTM_KEYS.some(key => params.has(key)) || CLICK_KEYS.some(key => params.has(key));
    let isExternalReferrer = false;
    try { isExternalReferrer = Boolean(cleanReferrer && new URL(cleanReferrer).origin !== new URL(href).origin); } catch (_) { /* ignore */ }
    const incomingSource = sourceFor(params, isExternalReferrer ? cleanReferrer : '');
    const incomingCampaign = params.get('utm_campaign') || '';
    const isNewTouch = hasCampaign || isExternalReferrer;

    const first = Object.keys(oldFirst).length ? oldFirst : {
      source: incomingSource,
      campaign: incomingCampaign,
      landing_page: page,
      referrer: cleanReferrer
    };
    const last = isNewTouch ? {
      source: incomingSource,
      campaign: incomingCampaign,
      medium: params.get('utm_medium') || '',
      content: params.get('utm_content') || '',
      term: params.get('utm_term') || '',
      fbclid: params.get('fbclid') || '',
      gclid: params.get('gclid') || '',
      landing_page: page,
      referrer: cleanReferrer
    } : (old.last_touch || (old.last_touch_source ? {
      source: old.last_touch_source,
      campaign: old.last_touch_campaign || '',
      medium: old.last_touch_medium || '',
      content: old.last_touch_content || '',
      term: old.last_touch_term || '',
      fbclid: old.last_touch_fbclid || '',
      gclid: old.last_touch_gclid || '',
      landing_page: old.last_touch_landing_page || page,
      referrer: old.last_touch_referrer || ''
    } : {
      source: incomingSource,
      campaign: incomingCampaign,
      medium: params.get('utm_medium') || '',
      content: params.get('utm_content') || '',
      term: params.get('utm_term') || '',
      fbclid: params.get('fbclid') || '',
      gclid: params.get('gclid') || '',
      landing_page: page,
      referrer: cleanReferrer
    }));

    const attribution = {
      utm_source: isNewTouch ? (params.get('utm_source') || '') : (old.utm_source || ''),
      utm_medium: isNewTouch ? (params.get('utm_medium') || '') : (old.utm_medium || ''),
      utm_campaign: isNewTouch ? (params.get('utm_campaign') || '') : (old.utm_campaign || ''),
      utm_content: isNewTouch ? (params.get('utm_content') || '') : (old.utm_content || ''),
      utm_term: isNewTouch ? (params.get('utm_term') || '') : (old.utm_term || ''),
      fbclid: isNewTouch ? (params.get('fbclid') || '') : (old.fbclid || ''),
      gclid: isNewTouch ? (params.get('gclid') || '') : (old.gclid || ''),
      landing_page: old.landing_page || page,
      referrer: old.referrer || cleanReferrer,
      first_touch_source: first.source || 'direct',
      first_touch_campaign: first.campaign || '',
      first_touch_landing_page: first.landing_page || page,
      first_touch_referrer: first.referrer || '',
      last_touch_source: last.source || incomingSource,
      last_touch_campaign: last.campaign || '',
      last_touch_medium: last.medium || '',
      last_touch_content: last.content || '',
      last_touch_term: last.term || '',
      last_touch_fbclid: last.fbclid || '',
      last_touch_gclid: last.gclid || '',
      last_touch_landing_page: last.landing_page || page,
      last_touch_referrer: last.referrer || ''
    };

    writeStorage(localStorage, FIRST_TOUCH_KEY, first);
    writeStorage(localStorage, ATTRIBUTION_KEY, attribution);
    return attribution;
  }

  function publicAttribution(attribution) {
    return Object.fromEntries(ANALYTICS_ATTRIBUTION_KEYS.map(key => [key, attribution[key] || '']));
  }

  function sanitizeProperties(properties = {}) {
    const clean = {};
    for (const [key, value] of Object.entries(properties)) {
      if (PII_KEY.test(key) || value === undefined || value === null) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') clean[key] = value;
      else if (Array.isArray(value)) clean[key] = value.map(item => {
        if (!item || typeof item !== 'object') return item;
        return Object.fromEntries(Object.entries(item).filter(([itemKey]) => !PII_KEY.test(itemKey)));
      });
      else if (typeof value === 'object') clean[key] = sanitizeProperties(value);
    }
    return clean;
  }

  function checkoutUrl(baseUrl, attribution, order = {}) {
    const url = new URL(baseUrl, root.location && root.location.href ? root.location.href : 'https://example.invalid/');
    const allAttribution = attribution || {};
    [...UTM_KEYS, ...CLICK_KEYS, 'landing_page', 'referrer',
      'first_touch_source', 'first_touch_campaign', 'first_touch_landing_page', 'first_touch_referrer',
      'last_touch_source', 'last_touch_campaign', 'last_touch_medium', 'last_touch_content',
      'last_touch_term', 'last_touch_fbclid', 'last_touch_gclid', 'last_touch_landing_page',
      'last_touch_referrer'].forEach(key => {
      if (allAttribution[key]) url.searchParams.set(key, allAttribution[key]);
    });
    if (order.attendance_type) url.searchParams.set('attendance_type', order.attendance_type);
    if (order.product) url.searchParams.set('product', order.product);
    if (order.value !== undefined) url.searchParams.set('value', String(order.value));
    if (order.currency) url.searchParams.set('currency', order.currency);
    if (order.order_bump !== undefined) url.searchParams.set('order_bump', order.order_bump ? '1' : '0');
    return url.toString();
  }

  function createTracker({ window: win, document: doc, config = CONFIG, storage, sessionStorage } = {}) {
    const browser = win || root;
    const page = doc || (browser && browser.document);
    let local = storage;
    let session = sessionStorage;
    try { local = local || (browser && browser.localStorage); } catch (_) { /* Storage may be disabled. */ }
    try { session = session || (browser && browser.sessionStorage); } catch (_) { /* Storage may be disabled. */ }
    const attribution = resolveAttribution({
      search: browser && browser.location ? browser.location.search : '',
      href: browser && browser.location ? browser.location.href : '',
      referrer: page ? page.referrer : '',
      localStorage: local
    });

    function trackEvent(eventName, properties = {}) {
      if (!EVENT_ALLOWLIST.has(eventName)) return false;
      const payload = sanitizeProperties({ ...properties, ...publicAttribution(attribution) });
      const data = { event: eventName, ...payload };
      try {
        if (browser) {
          browser.dataLayer = browser.dataLayer || [];
          browser.dataLayer.push(data);
          if (typeof browser.gtag === 'function' && config.GA4_MEASUREMENT_ID && !config.GTM_CONTAINER_ID) {
            const gaName = eventName === 'checkout_started' ? 'begin_checkout' : eventName;
            browser.gtag('event', gaName, payload);
          }
          if (typeof browser.fbq === 'function' && config.META_PIXEL_ID) {
            const standard = eventName === 'checkout_started' ? 'InitiateCheckout' :
              eventName === 'contact_submitted' ? 'CompleteRegistration' :
              eventName === 'payment_instructions_viewed' ? 'AddPaymentInfo' : null;
            if (standard) browser.fbq('track', standard, payload);
            else browser.fbq('trackCustom', eventName, payload);
          }
          if (config.ANALYTICS_DEBUG && browser.console) browser.console.info('[workshop analytics]', eventName, payload);
        }
      } catch (_) { /* Analytics errors must not affect the registration flow. */ }
      return true;
    }

    function oncePerSession(key, eventName, properties) {
      const storageKey = `ri_workshop_event_${key}`;
      try { if (session && session.getItem(storageKey)) return false; } catch (_) { /* ignore */ }
      try { if (session) session.setItem(storageKey, '1'); } catch (_) { /* ignore */ }
      return trackEvent(eventName, properties);
    }

    async function submitContact(contact, { trackSubmission = true } = {}) {
      if (!config.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT) return { ok: false };
      const tokenField = page && typeof page.getElementById === 'function' ? page.getElementById('turnstile-token') : null;
      const body = {
        ...contact,
        turnstile_token: tokenField ? tokenField.value : '',
        workshop_name: config.PRODUCT_NAME,
        workshop_date: config.WORKSHOP_DATE,
        registration_status: contact.registration_status || 'Landing Page Lead',
        payment_status: contact.payment_status || 'Unpaid',
        payment_amount: contact.payment_amount === undefined ? config.TICKET_PRICE : contact.payment_amount,
        order_bump: Boolean(contact.order_bump),
        attribution: { ...attribution }
      };
      try {
        const response = await browser.fetch(config.HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
          credentials: 'same-origin'
        });
        if (!response.ok) {
          let message = '';
          try { message = clean((await response.json()).error, 180); } catch (_) { /* use the safe fallback */ }
          return { ok: false, error: message || 'We could not save your registration. Please try again.' };
        }
        const result = await response.json();
        try {
          if (browser && browser.sessionStorage) browser.sessionStorage.setItem('ri_workshop_registration', JSON.stringify({
            registrationId: result.registration_id,
            registrationToken: result.registration_token
          }));
        } catch (_) { /* Storage can be unavailable. */ }
        if (trackSubmission) trackEvent('contact_submitted', { product: config.PRODUCT_ID });
        return { ok: true, registrationId: result.registration_id, registrationToken: result.registration_token };
      } catch (_) { return { ok: false, error: 'Registration is temporarily unavailable. Please try again.' }; }
    }

    async function submitCheckoutStart(registration, order) {
      if (!config.CHECKOUT_START_ENDPOINT || !registration || !registration.registrationToken) return false;
      try {
        const response = await browser.fetch(config.CHECKOUT_START_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            registration_token: registration.registrationToken,
            attendance_type: order.attendance_type,
            add_on_selected: Boolean(order.order_bump)
          })
        });
        return response.ok;
      } catch (_) { return false; }
    }

    async function submitBankTransfer(registration, order, proof) {
      if (!config.BANK_TRANSFER_ENDPOINT || !registration || !registration.registrationToken || !proof) return { ok: false };
      try {
        const response = await browser.fetch(config.BANK_TRANSFER_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            registration_token: registration.registrationToken,
            attendance_type: order.attendance_type,
            add_on_selected: Boolean(order.order_bump),
            payment_proof: proof
          })
        });
        if (!response.ok) return { ok: false };
        const result = await response.json();
        trackEvent('payment_proof_submitted', {
          payment_method: 'bank_transfer',
          attendance_type: order.attendance_type,
          value: order.value,
          currency: order.currency
        });
        return { ok: true, registrationId: result.registration_id, paymentStatus: result.payment_status };
      } catch (_) { return { ok: false }; }
    }

    return { config, attribution, trackEvent, oncePerSession, submitContact, submitCheckoutStart, submitBankTransfer, checkoutUrl: (base, order) => checkoutUrl(base, attribution, order) };
  }

  function inferCtaContext(anchor) {
    if (anchor.closest('.mobile-seat')) return { cta_location: 'sticky_mobile', page_section: 'mobile_seat' };
    if (anchor.closest('.offer-main')) return { cta_location: 'offer', page_section: 'tickets' };
    if (anchor.closest('.hero')) return { cta_location: 'hero', page_section: 'hero' };
    if (anchor.closest('.header')) return { cta_location: 'header', page_section: 'header' };
    if (anchor.closest('.registration')) return { cta_location: 'final_cta', page_section: 'registration' };
    if (anchor.closest('.footer')) return { cta_location: 'final_cta', page_section: 'footer' };
    const section = anchor.closest('section');
    return { cta_location: 'mid_page', page_section: section ? (section.id || section.classList[0] || 'section') : 'page' };
  }

  function loadIntegrations(config, win, doc) {
    win.dataLayer = win.dataLayer || [];
    if (config.GTM_CONTAINER_ID) {
      win.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      const gtm = doc.createElement('script');
      gtm.async = true;
      gtm.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(config.GTM_CONTAINER_ID)}`;
      doc.head.appendChild(gtm);
    } else if (config.GA4_MEASUREMENT_ID) {
      const ga = doc.createElement('script');
      ga.async = true;
      ga.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.GA4_MEASUREMENT_ID)}`;
      doc.head.appendChild(ga);
      win.gtag = function gtag() { win.dataLayer.push(arguments); };
      win.gtag('js', new Date());
      win.gtag('config', config.GA4_MEASUREMENT_ID, { send_page_view: false });
      win.gtag('event', 'page_view', {
        page_title: doc.title,
        page_location: win.location.origin + win.location.pathname
      });
    }

    if (config.META_PIXEL_ID) {
      const fbq = function fbq() {
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
      };
      fbq.queue = [];
      fbq.version = '2.0';
      win.fbq = win._fbq = fbq;
      const pixel = doc.createElement('script');
      pixel.async = true;
      pixel.src = 'https://connect.facebook.net/en_US/fbevents.js';
      doc.head.appendChild(pixel);
      fbq('init', config.META_PIXEL_ID);
      fbq('track', 'PageView');
    }
  }

  function initBrowser() {
    if (!root.window || !root.document) return;
    const win = root.window;
    const doc = root.document;
    win.WORKSHOP_ANALYTICS_CONFIG = CONFIG;
    try { loadIntegrations(CONFIG, win, doc); } catch (_) { /* Analytics loading must never disable the page. */ }
    const tracker = createTracker({ window: win, document: doc, config: CONFIG });
    win.workshopAnalytics = tracker;
    tracker.trackEvent('workshop_page_view', { page_section: 'landing_page' });

    doc.addEventListener('click', event => {
      const target = event.target && event.target.closest ? event.target.closest('a[href="#registration"], button[type="submit"]') : null;
      if (!target) return;
      const label = (target.textContent || '').trim().toLowerCase();
      if (!target.matches('a[href="#registration"]') && !label.includes('reserve my seat')) return;
      tracker.trackEvent('workshop_cta_click', inferCtaContext(target));
      tracker.oncePerSession('registration_started', 'registration_started', { page_section: 'registration' });
    });

    if (win.location.hash === '#registration') {
      tracker.oncePerSession('registration_started', 'registration_started', { page_section: 'registration' });
    }
  }

  const api = { CONFIG, ATTRIBUTION_KEY, resolveAttribution, publicAttribution, sanitizeProperties, checkoutUrl, createTracker, inferCtaContext, initBrowser };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.window && root.document) initBrowser();
})(typeof globalThis !== 'undefined' ? globalThis : this);
