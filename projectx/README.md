# ProjectX: Dubai party site

A phone-first site for ProjectX. It has a live laser hero with a beat you can play and switch (Afro House, Techno, Hip-Hop), upcoming nights shown as tickets, lineups, a box office with card checkout through Stripe, VIP tables, a ladies' list request through WhatsApp, and a FAQ.

## What's where

```
public/                 the website
  config.js             edit events, prices, lineups, contacts and FAQ here
  index.html, css/, js/ the page, styles, sound engine, light show
  success.html          confirmation page after payment
  legal.html            terms, refunds, privacy (draft, get it reviewed)
  og.jpg                the image shown when the link is shared
netlify/functions/
  checkout.js           creates the Stripe payment page for an order
  session.js            confirms the payment on the success page
tests/                  `npm test` checks config.js and the payment logic
```

## Change events and prices

Everything lives in `public/config.js`. Each event has a date (Dubai time), area, genres, a `vibe` that sets the hero colours and beat, a lineup and ticket types with prices in AED including VAT. Run `npm test` after editing. It catches the usual mistakes (bad dates, duplicate ids, missing prices).

- Mark a ticket type sold out: `soldOut: true`. Mark a whole night: `status: 'sold-out'`.
- Sell a night through an outside ticketing site: put its link in `ticketUrl` and its name in `ticketSiteName`. Every button for that night then goes there and the built-in checkout is off for that night.
- The lineup names are placeholders. Replace them with your real artists before you share the site.
- Add your WhatsApp number in `contact.whatsapp` (digits only, like `971501234567`). Until then the WhatsApp buttons stay hidden and guest list requests don't go anywhere.

## Preview locally

Open `public/index.html` in a browser, or run `npx serve public`. Checkout shows "Card payments aren't live" until the site runs on Netlify with a Stripe key.

## Put it online (Netlify)

1. In Netlify: Add new site, then Import from GitHub, then pick this repository.
2. Set **Base directory** to `projectx`. Netlify reads `netlify.toml` for the rest.
3. Add your domain under Domain management.
4. Once the domain works, change `og:image` in `public/index.html` to the full address (`https://yourdomain.com/og.jpg`). WhatsApp and Instagram previews need the full URL.

Netlify's free plan allows commercial sites. Vercel's free plan does not, so this project uses Netlify.

## Turn on card payments (Stripe)

1. Open a Stripe account for the UAE. Stripe asks for a valid UAE trade licence or freelancer permit and refuses accounts without one.
2. In Stripe, go to Developers, then API keys, and copy the **test** secret key (`sk_test_...`).
3. In Netlify, go to Site configuration, then Environment variables, and add `STRIPE_SECRET_KEY` with that key. Redeploy.
4. Buy a ticket on the live site with the test card `4242 4242 4242 4242`, any future expiry date and any CVC.
5. In Stripe, go to Settings, then Customer emails, and turn on receipts for successful payments. The receipt is the buyer's ticket.
6. When the test works, swap in the live key (`sk_live_...`).

The server sets every price from `config.js`, so a visitor can't change what they pay. Promo codes work if you create them in Stripe.

**Who paid:** Stripe Dashboard, then Payments. Every payment carries `event_id`, `guest_name` and `phone`. Export to CSV for the door list.

## Before you sell tickets

- **Dubai permit and ticketing rules.** Dubai's Department of Economy and Tourism (DET) requires an event permit before promotion or ticket sales. Organisers selling tickets for Dubai events must be integrated with DET's ticketing system, and DET charges 10% of total ticket sales for paid events. Either register as a ticket seller with DET, or sell through an authorised ticketing platform and put its link in `ticketUrl`. Confirm the current rules with DET before you take money.
- **No stock limit.** The site cannot stop overselling. Mark tiers sold out in `config.js` as soon as you reach capacity, or use a ticketing platform that tracks stock.
- **Tickets are Stripe receipts.** There is no QR scanning. The door checks names and IDs against the Stripe export.
- **VAT invoices.** If you are VAT-registered, Stripe receipts are not UAE tax invoices. Ask your accountant.
- **Legal page.** `legal.html` is a draft. Have it reviewed and add your licence details.
- **Photos and video.** Party brands sell on footage. Add your aftermovie and photos when you have them. To play your own DJ mix in the hero instead of the built-in beat, set `audio.mixUrl` (only music you have the rights to).

## Tests

```
npm test
```

Runs the config checks and the payment function tests (no Stripe account needed).
