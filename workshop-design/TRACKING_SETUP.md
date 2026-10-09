# Workshop CRM, checkout, and tracking setup

The custom landing-page form stays in place. HighLevel forms are not embedded. Browser code sends data only to same-origin Netlify Functions; private HighLevel webhook URLs, Turnstile secrets, PayFast credentials, and the signing key stay in Netlify environment variables.

## What connects to what

1. `tracking.js` sends the submitted attendee form to `/.netlify/functions/workshop-contact`.
2. `workshop-contact.js` verifies Cloudflare Turnstile, normalizes `karachi` to `onsite`, creates a unique registration ID, sends the lead to the HighLevel registration workflow, and returns a signed registration session to the browser.
3. When the visitor presses **Continue to Payment**, `app.js` sends only the signed session and order choices to `/.netlify/functions/workshop-checkout`. The server recalculates PKR 5,000 or PKR 10,000 and calls the HighLevel checkout-start workflow. This endpoint never marks a registration paid.
4. `workshop-payfast-start.js` requests a short-lived access token using server-only PayFast credentials and returns the documented hosted-form fields. The browser posts those fields to PayFast; it never receives the secured key.
5. PayFast calls `/.netlify/functions/workshop-payfast-callback` server-to-server by GET or POST. The function recalculates SHA-256 over `basket_id|secured_key|merchant_id|err_code`, compares the hash in constant time, and checks the stored basket, merchant amount, PKR currency, success code `000`, and transaction ID. Only then does it claim the transaction in Netlify Blobs, create the signed ticket, and call the HighLevel paid workflow. Repeated callbacks return HTTP 200 without issuing another ticket or paid event.
6. The bank-transfer panel submits its signed registration session and compressed payment screenshot to `/.netlify/functions/workshop-bank-transfer`. The screenshot is stored privately in Netlify Blobs. HighLevel receives a signed proof link, moves the registration to **Payment Pending**, and leaves payment status **Unpaid**.
7. After a person verifies the bank transfer, HighLevel calls `/.netlify/functions/workshop-bank-verify` with the registration ID and a private bearer secret. This creates the same signed ticket and calls the same paid workflow used by PayFast. The ticket can be opened at its private `ticketUrl`; a made-up ticket ID without a valid signed link is rejected.

## Browser configuration

The single `CONFIG` object at the top of `tracking.js` contains public values only:

- `META_PIXEL_ID`, `GA4_MEASUREMENT_ID`, or `GTM_CONTAINER_ID`
- `TURNSTILE_SITE_KEY` — public site key only
- `BANK_TRANSFER_READY` — keep `false` until the real bank details have replaced every placeholder
- `BANK_NAME`, `BANK_ACCOUNT_TITLE`, `BANK_IBAN`, and `BANK_ACCOUNT_NUMBER` — public receiving details shown to the attendee
- Product, workshop date, PKR prices, and same-origin function paths

Do not put webhook URLs, API keys, PayFast merchant credentials, bank details, or signing secrets in `tracking.js`, `app.js`, HTML, or GitHub.

## Netlify environment variables

Set these for the production deploy:

| Variable | Purpose |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | Validates the public form submission |
| `WORKSHOP_SIGNING_SECRET` | Random secret of at least 32 characters used to sign registration sessions |
| `WORKSHOP_PUBLIC_URL` | Public site origin, normally `https://workshop.revenueincarnate.com` |
| `MANUAL_PAYMENT_VERIFY_SECRET` | Random secret of at least 32 characters used only by the HighLevel manual-verification webhook action |
| `HIGHLEVEL_REGISTRATION_WEBHOOK_URL` | HighLevel workflow 1 inbound webhook |
| `HIGHLEVEL_CHECKOUT_WEBHOOK_URL` | HighLevel workflow 2 inbound webhook |
| `HIGHLEVEL_PAID_WEBHOOK_URL` | HighLevel workflow 4 inbound webhook |
| `HIGHLEVEL_BANK_TRANSFER_WEBHOOK_URL` | HighLevel workflow 5 inbound webhook |
| `PAYFAST_MODE` | `uat` while testing; change to `live` only after PayFast issues production credentials |
| `PAYFAST_MERCHANT_ID` | PayFast merchant ID |
| `PAYFAST_SECURED_KEY` | PayFast secured key |
| `PAYFAST_MERCHANT_NAME` | Name displayed at PayFast; normally `Revenue Incarnate` |
| `HIGHLEVEL_PAYMENT_FAILED_WEBHOOK_URL` | Optional HighLevel webhook that moves a valid failed payment to **Payment Failed** |

`HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT` remains supported as a temporary fallback for the registration workflow only.

The checkout callback is `https://workshop.revenueincarnate.com/.netlify/functions/workshop-payfast-callback`. Success and failure redirects are informational only; they never mark an order paid. Netlify Blobs provides durable transaction idempotency.

## HighLevel workflow mapping

### 1. Workshop — Registration submitted

Trigger: inbound webhook from `HIGHLEVEL_REGISTRATION_WEBHOOK_URL`.

- Find/upsert the contact by email, with phone as the secondary identifier.
- Map registration, workshop, attendance, attribution, and order fields.
- Add campaign, format, and `workshop-unpaid` tags.
- Create or update one opportunity whose stable key is `registration_id`; place it in **Workshop Registrations → Lead Captured**.
- Send an internal registration notification.

### 2. Workshop — Checkout started

Trigger: inbound webhook from `HIGHLEVEL_CHECKOUT_WEBHOOK_URL`.

- Find the matching record by `registration_id`.
- Update attendance, add-on, ticket value, total order value, and currency.
- Move the opportunity to **Checkout Started**.
- Keep payment status **Unpaid** and never add a paid tag.

### 3. Workshop — Checkout abandoned

Trigger: opportunity enters **Checkout Started**.

- Wait for the chosen abandonment window.
- Continue only when `form_submitted` is true and payment status is still **Unpaid**.
- Stop immediately when payment status becomes **Paid**.
- Move the opportunity to **Checkout Abandoned**, add `workshop-checkout-abandoned`, and send the approved follow-up.

### 4. Workshop — PayFast payment verified

Trigger: inbound webhook from `HIGHLEVEL_PAID_WEBHOOK_URL`; it must not accept browser events.

- Find the matching record by `registration_id`.
- Store PayFast transaction ID, verified amount, payment method, and verified timestamp.
- Set payment status to **Paid**, move to **Paid / Registered**, remove unpaid/pending/abandoned tags, and add `workshop-paid`.
- Send the confirmation and ticket exactly once, keyed by PayFast transaction ID.
- Send the internal paid-registration notification.

### 5. Workshop — Bank transfer

Trigger: inbound webhook from `HIGHLEVEL_BANK_TRANSFER_WEBHOOK_URL`.

- Move the opportunity to **Payment Pending**, add `workshop-payment-pending`, and retain **Unpaid**.
- Store `paymentProofUrl` and `paymentProofReceivedAt` from the webhook. The proof link is private, expires after 30 days, and must not be copied into analytics.
- A manual-verification action sends a server-side POST to `/.netlify/functions/workshop-bank-verify` with `Authorization: Bearer <MANUAL_PAYMENT_VERIFY_SECRET>` and JSON `{ "registration_id": "{{contact.registration_id}}" }`.
- That function sets verified amount/timestamp, creates or reuses one signed ticket, and invokes the same one-time confirmation/ticket branch as workflow 4.

The paid webhook now includes `ticketId` and `ticketUrl`. Map both as opportunity fields and insert `ticketUrl` into the paid confirmation email. For online attendees, add the private Google Meet link in HighLevel only after `paymentStatus` becomes `Paid`; do not publish the Meet URL on the landing page or unpaid messages.

## Field plan

Contact fields hold identity and attribution: registration ID, workshop name/date, attendance type, first-touch source, last-touch source, UTM source/medium/campaign/content/term, `fbclid`, `gclid`, landing page, referrer, and `form_submitted`.

Opportunity fields hold the order/payment record: registration ID, ticket type, base ticket amount, add-on selected, total order value, amount paid, currency, payment status, payment method, PayFast transaction ID, and verified payment timestamp. Use the standard opportunity monetary value for total order value as well, so revenue widgets work natively.

Recommended tags:

- `workshop-registration-2026-10-25`
- `workshop-onsite`
- `workshop-online`
- `workshop-unpaid`
- `workshop-paid`
- `workshop-checkout-abandoned`
- `workshop-payment-pending`

## Reporting

Use a dedicated HighLevel dashboard filtered to the **Workshop Registrations** pipeline. Add widgets for stage counts, opportunity value/revenue, paid versus unpaid, attendance type, and opportunity source/UTM source. The paid workflow must populate both `amount_paid` and the standard opportunity monetary value.

## Analytics privacy

The browser event allowlist excludes server-only `payment_verified` and `purchase`. Analytics payloads strip names, email, phone, addresses, and payment-proof fields. Landing page/referrer values are stored without query strings. Do not configure GTM, GA4, Meta, or Clarity tags to ingest contact custom fields, HighLevel webhook payloads, or form element values.

## Verification

Run:

```sh
npm test
```

Before opening bank transfer, replace the placeholder bank details in `tracking.js`, set `BANK_TRANSFER_READY` to `true`, and submit a real low-value proof through the complete workflow. Test a registration, checkout start, failed/abandoned checkout, verified PayFast callback, repeated callback, and manual bank-transfer verification in sandbox/test mode before enabling live payment. Confirm that one registration ID produces one opportunity, one ticket, and one confirmation.
