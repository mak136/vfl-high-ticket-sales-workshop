# High-Ticket Sales Workshop page

Open `index.html` to view the page. Keep `style.css`, `app.js`, and `assets/` beside it. No build step is needed.

The page now uses Afroze Khan, 24 October 2026, one PKR 5,000 workshop ticket, the confirmed Karachi ticket disclosure, bank transfer and PayFast card payment, and `billing@revenueincarnate.com` as the proposed support inbox. It explains VFL and the intended workshop experience. Real photography documents a live high-ticket sales session, audience participation, Afroze's event presence, and his Connected Pakistan award.

The checkout preview preserves the selected attendance preference and calculates PKR 5,000 for the workshop or PKR 10,000 when the optional Implementation Pack is selected. Edit the centralized configuration in `tracking.js` and the pack details in `app.js` when those details are finalized. The payment button remains a preview until a real checkout URL and verified provider flow are configured.

The analytics and attribution layer, Netlify HighLevel proxy, automated tests, event names, and provider setup requirements are documented in `TRACKING_SETUP.md`. Analytics provider IDs are blank by design. The contact proxy needs its private HighLevel endpoint set in Netlify before it can save leads; its failure does not block the page flow. The page does not claim a registration or purchase until a real payment is confirmed by a provider integration.

## Details still needed before paid checkout opens

- Start time and duration
- Exact online platform and joining instructions
- Final session activities, materials, and online participation format
- Final Implementation Pack contents
- Replay availability and access period
- Confirmation timing for bank transfers and card payments
- Confirm the billing inbox is active
- Privacy notice and registration terms

The Karachi address is deliberately absent from public page copy and should appear on the attendee ticket after payment. The current form is a local design preview: it does not submit attendee information, charge a card, or reserve a seat. Connect it to the final PayFast and bank transfer flow after the remaining details are confirmed.
