# High-Ticket Sales Workshop page

Open `index.html` to view the page. Keep `style.css`, `app.js`, and `assets/` beside it. No build step is needed.

The page now uses Afroze Khan, 24 October 2026, one PKR 5,000 workshop ticket, the confirmed Karachi ticket disclosure, bank transfer and PayFast card payment, and `billing@revenueincarnate.com` as the proposed support inbox. It explains VFL and the intended workshop experience. Real photography documents a live high-ticket sales session, audience participation, Afroze's event presence, and his Connected Pakistan award.

The checkout preserves the selected attendance preference and calculates the order server-side. Registration and checkout-start events go through same-origin Netlify Functions and HighLevel webhooks. Online checkout uses PayFast's hosted form; the secured key remains in Netlify and the site trusts only a hash-verified PayFast IPN callback.

The complete connection map, HighLevel workflow design, Netlify variables, PayFast verification, durable callback deduplication, analytics layer, and testing requirements are documented in `TRACKING_SETUP.md`. Analytics provider IDs are blank by design. The page never claims a paid registration until PayFast is read back from the server or a bank transfer is manually verified.

## Details still needed before paid checkout opens

- Start time and duration
- Exact online platform and joining instructions
- Final session activities, materials, and online participation format
- Final Implementation Pack contents
- Replay availability and access period
- Confirmation timing for bank transfers and card payments
- Confirm the billing inbox is active
- Privacy notice and registration terms

The Karachi address is deliberately absent from public page copy and should appear on the attendee ticket after payment. The custom form is retained; it is not replaced with a HighLevel embed. Live charging remains disabled until the final PayFast production values and checkout URL are supplied.
