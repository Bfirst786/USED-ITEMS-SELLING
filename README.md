# Resell Assistant

A phone-first app for selling your used stuff. Photograph an item, get a suggested
price, see which platforms to list it on, write the listing, track every listing's
URL and posting date, and get rule-based reminders to renew, drop the price,
cross-list or take listings down.

It's an installable web app (PWA): open it in your phone's browser, add it to your
home screen, and it runs full screen and offline like a normal app. All your data
stays on your phone.

## Features

- **Three price tiers**: under $100, $101–$500, and $501+. Every item is placed in a
  tier by its asking price (or suggested price), and you can filter by tier.
- **Photos**: take photos with the camera or pick them from your library. They're
  resized and stored on the device.
- **Suggested selling price**
  - *Estimate price* (works offline): depreciates the original retail price by
    category, condition and age, and blends in any recent **sold** prices you enter.
    It gives a target, a range, a price to list at (with room to negotiate), and the
    lowest price you should accept. Links open eBay sold listings and Facebook
    Marketplace so you can look up comps.
  - *Analyze with Claude* (optional): Claude looks at your photos to identify the
    item, brand and condition, estimates a price, recommends platforms, writes a
    description, and asks questions that would change the price. You can also let it
    search the web for comparable sold prices.
- **Market price check** (Claude, optional): a *Check market prices* button has
  Claude search the web for sold and for-sale listings of comparable items, then shows
  the typical sold price, sold and asking ranges, a suggested list price and floor,
  and the comparable listings with links. Links that didn't come from the actual
  search results are thrown out, along with their listings. Items over $100 that
  haven't been checked, or were checked over 30 days ago, get a *🔎 Check price*
  badge and a reminder on their price section. Cheaper items can still use the
  button. Each check uses a few web searches, billed with your Claude API usage.
- **Where to sell**: ranks marketplaces (Facebook Marketplace, OfferUp, Craigslist,
  Nextdoor, eBay, Mercari, Poshmark, Depop, Grailed, Swappa, Reverb, Chrono24,
  The RealReal, Chairish, Kaiyo, Pinkbike, Decluttr, FB groups) by category, price
  tier and whether the item is bulky. Each one shows why it was picked and links
  straight to that platform's sell page. eBay is always included.
- **Ready for eBay**: a step-by-step sheet in the order of eBay's listing form:
  photos (saved to your camera roll in one tap), title, category, item specifics,
  condition, description, price with Best Offer thresholds based on your lowest
  price, shipping, and returns. Each field has a Copy button and a check mark. Claude
  can fill in the category and item specifics. Paste the eBay link at the end and
  the app starts tracking the listing. Other marketplaces can be added as profiles
  in `js/ready.js`.
- **Listing tracker**: for each platform, store the listing URL, posting date, price
  and status (active / ended / sold). Mark a listing "renewed" when you bump it.
  Delete a listing from tracking with its 🗑 button.
- **Shipping estimate** (optional, per item): tap **✨ Estimate box & weight** to have
  Claude size the item from your photos and details (using published specs when it
  recognises the model), pick a padded box and estimate the packed weight, with
  packing tips. Estimates are marked until you weigh or measure. Or pick a box preset
  and enter dimensions and packed weight yourself to get a rough USPS Ground Advantage / UPS Ground price range. It
  accounts for dimensional weight and flags oversize or overweight boxes, then suggests
  what to charge the buyer or the price to list at with free shipping. Links to the
  carriers' calculators are included for exact prices.
- **Reminders based on rules**: default rules per tier (all editable in Settings):

  | Rule | ≤ $100 | $101–$500 | $501+ |
  |---|---|---|---|
  | Renew / bump each listing | every 7 days | every 7 days | every 10 days |
  | Price drop if unsold | 10% after 7 days | 10% after 10 days | 5% after 14 days |
  | Cross-list on another platform | — | 21 days | 21 days |
  | Rethink price / rewrite | — | 45 days | 60 days |
  | Bundle, garage sale or donate | 30 days | — | — |

  For all items: a nudge if a draft hasn't been posted after 2 days, and a reminder to
  take down the other listings when something sells. Price drops never go below your
  "lowest I'll take" price. You can add your own rules, snooze reminders, apply a
  price drop with one tap, and add reminders to your phone's calendar (.ics) so they
  alert you even when the app is closed.
- **Listing writer**: generates a title and description for the platform you choose
  (short and friendly for local pickup, keyword-rich for shipped). Quick edits
  (Title Case, Shorten, Fix shouting, Trim filler, Tidy), character counters for
  platform limits, a checklist that catches common problems (no condition, no
  dimensions, no size, contact info or off-platform payment in the text, too few
  photos), one-tap copy, and *Improve with Claude* with optional custom instructions
  and undo.
- **Live Google Sheet** (optional): keeps a Google Sheet updated with an **Items**
  tab (one row per item: tier, status, prices, sold info, listing title and
  description, details and notes) and a **Listings** tab
  (one row per listing: platform, URL, posting date, price, status). The sheet is
  rewritten a few seconds after every change; changes made while offline are sent
  when you're back online. Set it up in **Settings → Google Sheets sync**.
- **Google Drive backups** (with the Google Sheet connected): full backups,
  including listing text and photos, go into a **Resell backups** folder next to
  your sheet. One is made automatically once a day when something has changed, and
  you can tap **Back up to Google Drive now** at any time. The newest 10 are kept, and
  each photo is uploaded only once. **Restore from Google Drive** brings everything
  back, including onto a new phone, using the Web app URL and your sync code (shown
  under Settings → Google Sheets sync → Security & sync code).
- **Backup file**: download/restore a full backup file (photos included) and export a
  CSV spreadsheet of all listings.

## Put it on your phone

The app is static files, so any HTTPS web host works. The easiest is GitHub Pages:

1. Merge this branch into `main`.
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` runs the tests and publishes the app
   at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link on your phone:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ → *Install app* / *Add to Home screen*

## Turn on Claude (optional)

1. Create an API key at <https://console.anthropic.com/settings/keys>. API use is
   billed by Anthropic pay-as-you-go; a single photo analysis typically costs cents.
2. In the app: **Settings → Claude AI**, paste the key, then tap *Test connection*.

The key is stored only in the app's storage on your phone and is never included in
backups. The app calls the Anthropic API directly from your phone, so treat the
device like you would any device with a saved password. You can choose Claude Opus
5.5 (default, best results), Sonnet 5.5 (faster/cheaper) or Haiku 4.5 (cheapest).

## Keep a live Google Sheet (optional)

1. On a computer, create a Google Sheet (<https://sheets.new>).
2. In the app, open **Settings → Google Sheets sync** and tap **Copy script**.
3. In the sheet: **Extensions → Apps Script**, replace everything with the copied
   script, and save.
4. **Deploy → New deployment → Web app**, with *Execute as: Me* and *Who has access:
   Anyone*. Authorize it. Google warns that the app is unverified because it's your
   own script, so choose *Advanced → Go to … (unsafe)*.
5. Paste the **Web app URL** (ends in `/exec`) into the app. The app tests the connection and shows
   the name of the spreadsheet it's writing to. If it can't connect, it says why.
   Use **Test connection** any time to check again.

The script only accepts updates carrying the private sync code built into it, so
knowing the URL isn't enough to change your sheet. The sheet is a mirror: make
changes in the app, because edits made in the sheet are overwritten.

## Good to know

- **Notifications**: tap *Turn on notifications* on the Reminders screen. Without a
  server, web apps can only alert you when the app is open or recently opened, so for
  reliable alerts use *Add all upcoming to my calendar*.
- **Prices and fees are estimates.** Check sold listings before you commit to a
  price, and platforms change their fees often, so check the current fees on each
  site.
- **Data lives on one device.** Download a backup now and then, especially before
  clearing browser data or switching phones.

## Development

No build step. Plain HTML/CSS/JavaScript modules.

```bash
npm start      # serves the app at http://localhost:8080
npm test       # unit tests (Node 18+) for pricing, platforms, reminders and writer
```

| File | What it does |
|---|---|
| `index.html`, `styles.css` | App shell and mobile-first styling (light/dark) |
| `js/app.js` | Screens, routing and user actions |
| `js/db.js` | IndexedDB storage for items, photos and settings |
| `js/pricing.js` | Tiers, categories, conditions and the price estimator |
| `js/platforms.js` | Marketplace catalog and recommender |
| `js/reminders.js` | Reminder rules engine and calendar (.ics) export |
| `js/writer.js` | Listing drafts, quick edits and the checklist |
| `js/ai.js` | Claude API calls (photo analysis, listing editing) |
| `js/ready.js` | "Ready for <marketplace>" sheets (eBay profile) |
| `js/shipping.js` | Shipping estimator (box presets, dimensional weight, rate ranges) |
| `js/sheets.js` | Google Sheets sync: row building, the Apps Script, and sending updates |
| `sw.js`, `manifest.webmanifest` | Offline support and install-to-home-screen |
