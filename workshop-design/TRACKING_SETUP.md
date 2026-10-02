# Workshop tracking setup

This page has an attribution and analytics layer prepared for Meta, GA4/GTM, and a HighLevel CRM proxy. It deliberately contains no invented account IDs. Until the real IDs, CRM endpoint, and checkout URL are configured, analytics providers and paid checkout remain inactive.

## Configuration

Edit the single `CONFIG` object near the top of `tracking.js`:

- `META_PIXEL_ID`: Meta Events Manager Pixel ID.
- `GA4_MEASUREMENT_ID`: GA4 Measurement ID, normally `G-…`.
- `GTM_CONTAINER_ID`: GTM container ID, normally `GTM-…`. When configured, GTM takes precedence over direct GA4 loading so GA4 is not loaded twice. Configure GA4 in the GTM container.
- `HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT`: keep this as `/.netlify/functions/workshop-contact`; it is a same-origin proxy, not the upstream secret URL.
- `CHECKOUT_URL`: the real PayFast or other provider checkout URL. Keep blank until the provider is ready to receive the order and attribution fields.

Deploy with Netlify Functions enabled. In the Netlify site's environment variables, set `HIGHLEVEL_WEBHOOK_OR_FORM_ENDPOINT` to the private HTTPS inbound webhook URL for the HighLevel workflow. Do not put this upstream URL, an API key, or any secret in `tracking.js` or other browser code. The function validates the contact, formats the workshop fields, and forwards the request. Configure HighLevel to find/update an existing contact using email (and phone as an additional match) before creating a new record. Map the forwarded contact, registration, payment status, attendance, order bump, and attribution fields to the appropriate HighLevel standard/custom fields. Pipeline stages are an internal CRM configuration and are not created by the website.

Before enabling the CRM endpoint, test its workflow with a test contact and confirm update-or-create behavior. The contact form currently submits to the proxy asynchronously; CRM failure does not block moving through the page.

## Attribution behavior

On first visit, the browser stores first-touch source, campaign, landing page, and referrer in local storage. A later tagged visit or external referral updates last touch; a direct revisit preserves it. UTM values, `fbclid`, `gclid`, clean landing-page URL, and clean referrer are also retained. Query strings are removed from stored page/referrer URLs to avoid carrying unrelated query data.

The contact proxy forwards attribution to HighLevel. Once `CHECKOUT_URL` is configured, the checkout redirect appends attribution, attendance format, product, amount, currency, and order-bump choice. The payment provider must retain these fields on its checkout/order record and include them in its verified webhook if purchase attribution is to be joined end-to-end. Do not append name, email, or phone to the checkout URL.

## Events

The browser event layer sends events to `dataLayer`; it sends them to GA4 directly only when GTM is not configured, and to Meta when a Pixel ID is configured. Configure matching GTM triggers/tags if GTM is used.

| Event | When it fires | Notes |
| --- | --- | --- |
| `workshop_page_view` | Landing page loads | Custom workshop event; GA page view is sent by the analytics integration. |
| `workshop_cta_click` | Primary seat CTA click | Includes `cta_location` and `page_section`. |
| `registration_started` | First CTA/registration entry per browser session | Session deduplicated. |
| `attendance_selected` | User changes attendance choice | `attendance_type` is `karachi` or `online`. |
| `contact_submitted` | CRM proxy confirms successful submission | PII is never sent to analytics vendors. Maps to Meta `Lead`. |
| `checkout_started` | Redirect to configured external checkout | Includes amount, currency, product, attendance, and bump choice. Maps to GA4 `begin_checkout` and Meta `InitiateCheckout`. It is not sent while checkout is still the local preview. |
| `order_bump_viewed` | Checkout step shows the optional pack | Session deduplicated. |
| `order_bump_selected` | User selects the optional pack | The no-bump choice is represented as `order_bump: false` on `checkout_started`. |
| `payment_instructions_viewed` | Available event for a future manual-instructions screen | No such screen is active yet. |
| `payment_proof_submitted` | Available event for a future proof-upload flow | No upload flow is active; this is not a purchase. |
| `payment_verified` | **Server only; not implemented until the provider webhook is connected** | Must follow payment-provider verification. Never fire on form submission or uploaded proof. |
| `purchase` | **Server only; not implemented until the provider webhook is connected** | Must contain the provider transaction ID and verified amount. The browser tracker rejects `payment_verified` and `purchase`. |

The event that represents a paid customer is `purchase`, only after a trusted provider webhook verifies payment. Implement durable deduplication using the provider's transaction ID before sending any purchase to GA4 Measurement Protocol or Meta Conversions API. Use the same event ID for browser/server deduplication if both channels send a Meta purchase. No browser purchase event or Conversions API call is implemented because provider verification details and secrets are not available yet.

## Testing

Run the local automated suite from the repository root:

```sh
node --test outputs/workshop-design/tests/*.test.js
```

It checks Meta and community UTMs, direct visits, external referrals, first/last-touch persistence, CTA placement, PII filtering, successful/failed CRM proxy submissions, proxy validation and contact mapping, checkout attribution, bump accepted/declined values, manual-payment event names, and rejection of client-forged/duplicate purchase events.

After real IDs and integrations are configured, use Meta Test Events and GA4 DebugView/GTM Preview with test values. Verify a Meta-tagged visit followed by a community-tagged visit retains the original first touch and updates last touch; verify a direct revisit leaves last touch intact; click the hero, offer, footer, and sticky mobile CTAs; choose each attendance format; submit a test contact; inspect the outbound checkout URL and provider order record; then test bump selected and unselected. Do not use a real payment to test analytics unless the payment provider offers a sandbox.

Payment verification, actual purchase events, server-side deduplication, Conversions API, manual bank-transfer instructions, and payment-proof upload still require a confirmed payment provider/webhook and CRM workflow. The page's current local checkout preview must not be described as a completed or paid registration.
