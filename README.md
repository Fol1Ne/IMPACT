# IMPACT — Global Disaster Intelligence. Humanitarian Action.

HackUCD 2026 submission. IMPACT puts real natural-hazard events on an interactive 3D globe: earthquakes from **USGS** plus wildfires, severe storms, volcanoes, floods and more from **NASA EONET**. Click a country for its news and the events inside it, drop a pin for a **safety check** of nearby hazards, get in-app **notifications** for new events, generate a **grounded AI briefing** for earthquakes, and try two **Stripe test-mode** flows: a preparedness-package purchase (Checkout) and a **Stripe Connect donation** to a test charity account.

> IMPACT is an independent information platform, **not** an official emergency service or alerting system. All Stripe flows are test mode; no real money moves.

## Problem and idea
After a disaster, people see alarming headlines but struggle to separate confirmed facts from speculation, and to find trustworthy places to learn or help. IMPACT shows only what the sources record, labels AI interpretation separately, states what is unknown, and links to official organisations.

## Features
- **Two event sources, one model.** USGS (FDSN event query) and NASA EONET v3 are normalised on the server into one `HazardEvent` shape (`shared/types.ts`) with category, position, track or polygon centre, reported size, times and every source link.
- **Conservative cross-source matching.** An EONET earthquake is merged with a USGS one only if it cites that USGS event page, or if exactly one USGS quake is within 5 minutes, 30 km and 0.3 magnitude. Merged events keep both providers' links and say how they were matched. In practice EONET carries very few earthquakes, so merges are rare.
- **Date ranges:** last 24 hours, 7, 30, 90 days, last year (rolling 365 days) or custom UTC dates up to 366 days. Ranges over 31 days show earthquakes at M4.5+ only, because USGS caps one query at 20,000 events (a year at M2.5+ is about 29,000). EONET is fetched in 30-day windows; a full year is about 9,000 EONET records and takes roughly 30 s the first time, then is cached.
- **Armed conflict (countries, not a date window):** the Conflict tab and globe tint list **countries Wikipedia currently names** on [List of ongoing armed conflicts](https://en.wikipedia.org/wiki/List_of_ongoing_armed_conflicts). That list is independent of the event date filter. Click a country to fly there and open its news. This is not an official designation, front line or map of territorial control. Names that cannot be mapped to an ISO country code are skipped, not guessed.
- **Filters:** event type (with counts), source, earthquake magnitude, text search, sort.
- **Hide on each card:** every floating card (filters, event list, side panel, recent strip, legend) has its own hide control. Hidden cards reappear as "Show …" chips. Hiding a whole column lets the globe use the space. Saved in localStorage; selecting an event or country reopens the side panel.
- **Globe:** flat clickable circles (not 3D pillars), magnitude colours for quakes, storm tracks for the selected event, country click → zoom + country news + the event records inside that country. Countries on Wikipedia's current-conflict list are tinted when Armed conflict is on.
- **News tab** (right side): Google News RSS headlines for the selected country, or global disaster headlines when none is selected. Headlines are labelled as coverage, not verified event records. Article bodies are never fetched.
- **Safety planner tab:** drop a pin, press **Use my location** (browser geolocation, opt-in) or type coordinates; the check starts automatically. The server collects (a) recent events nearby from the same hazard layer and (b) the **long-term disaster record** within the radius. If the pin sits in a Wikipedia-listed conflict country, that is shown as a country listing, not as invented battle events. You can enter an international phone number for **SMS alerts** (Twilio, server-side): confirmation plus a text if a major disaster is reported in the radius (earthquakes M6+, storms, floods, wildfires, volcanoes). Not an official warning system. See *AI grounding* below.
- **Notifications:** in-tab only, opt-in. Choose event types, earthquake magnitude, area (anywhere, the selected country, or 500 km around the planner pin) and a grouping cooldown. The first check only sets a baseline, each event notifies once, and repeats inside the cooldown are grouped. Preferences live in this browser's localStorage.
- **Earthquake detail:** source facts, AI briefing, resources, and the sandbox preparedness package (Stripe Checkout).
- **Donate (Stripe test mode):** the header button hides every panel and opens a popup with four charities (IFRC, MSF, UNICEF, WFP). Clicking one opens Stripe Checkout, where the donor chooses the amount. If that charity has a transfer-ready test connected account, the payment is a destination charge to it; otherwise the test payment stays on the platform's test balance and the UI says nothing was transferred. On return, the result is read from Stripe by the server. Closing the popup restores the panels.

## Stack
React 19 + TypeScript + Vite · react-globe.gl · Stripe.js + React Stripe.js · Node + Express (TypeScript, run with `tsx`) · zod · helmet · express-rate-limit · Stripe SDK · Vitest + Supertest. One npm-workspaces repo (`client`, `server`, `shared`). No database: verified checkout sessions and donation statuses are kept in small JSON files under `server/data/` (ids, amounts and states only; no personal or card data).

## Structure
```
client/  src/{components,hooks,lib,styles,data}, public/textures (globe images from three-globe, MIT)
server/  src/{routes,services,middleware}, scripts/create-test-charity.ts, tests/
shared/  types.ts (event model, ranges, filters), notify.ts (notification rules)
```

## Setup
Prerequisites: Node.js 20+ and npm.
```bash
npm install
cp .env.example .env      # then edit .env
npm run dev               # server :PORT + client :5173 -> open http://localhost:5173
```
The Vite proxy reads `PORT` from `.env`, so you can move the API off 3001 if something else uses it. Single-port mode: set `CLIENT_URL=http://localhost:<PORT>`, then `npm start`.

### Vercel
The client is a static Vite build; `/api/*` is the Express app as a serverless function (`api/[...path].ts`). Set the same server env vars in the Vercel project. `CLIENT_URL` can be omitted (the deployment URL is used). JSON stores are in-memory on Vercel, so SMS polling and donation records do not survive cold starts.

Other scripts: `npm test` (server tests, all external APIs mocked), `npm run typecheck`, `npm run build`.

### Environment variables (root `.env`)
| Variable | Purpose |
|---|---|
| `PORT`, `CLIENT_URL` | Server port; browser origin used for CORS and Stripe return URLs |
| `NASA_EONET_BASE_URL` | Optional override. USGS, EONET and Google News need no keys |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Server-only. Required for pin SMS alerts |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODEL`, `OPENROUTER_TIMEOUT_MS` | Server-only AI settings. Fallbacks (comma-separated) are tried when the primary returns 402/404/429/5xx or an empty reply. Without a key, AI features fall back to source data |
| `STRIPE_CHARITY_IFRC`, `_MSF`, `_UNICEF`, `_WFP` | Optional `acct_…` test connected accounts for the Donate popup |
| `STRIPE_SECRET_KEY` | `sk_test_…` (or `rk_test_…`). Live keys are refused |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…`. The only Stripe value sent to the browser |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from `stripe listen`. Needed for donation status |
| `STRIPE_CONNECTED_ACCOUNT_ID` | `acct_…` of the test charity account |
| `DONATION_*` | Charity display name, currency (default eur), min/max in cents (default 1–500) |
| `PRODUCT_PRICE_CENTS`, `PRODUCT_CURRENCY` | Preparedness package price |

Secrets never reach the browser; `/api/health` and `/api/donations/config` report only booleans, public values and problems.

### OpenRouter
Create a key at https://openrouter.ai/keys, set `OPENROUTER_API_KEY`, choose `OPENROUTER_MODEL` (the default is not verified against the live catalogue), restart.

### Armed-conflict countries
The server fetches Wikipedia's [List of ongoing armed conflicts](https://en.wikipedia.org/wiki/List_of_ongoing_armed_conflicts) via the MediaWiki API (`action=parse`, wikitext) and reads `{{flag|Country}}` templates from that page. Each mapped name becomes an ISO country code; unmapped names (for example unrecognised states) are listed as skipped. Cached for 6 hours. The list is **not** filtered by the event date range.

### SMS alerts (Twilio)
Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` (E.164). The Safety tab accepts an international number for the current pin. The server stores the number only for these alerts, sends a confirmation, and texts when a **new** major event appears in the radius (earthquakes M6+, storms, floods, wildfires, volcanoes). A 5-minute poller checks the 24-hour hazard feed. Without Twilio, the form says SMS is not configured. Numbers are never sent to the browser after subscribe (last 4 digits only).

### Stripe: preparedness purchase (Checkout)
1. Stripe Dashboard → **Test mode** → Developers → API keys → secret key into `STRIPE_SECRET_KEY`.
2. Select an earthquake → **Preparedness** → *Unlock*. Pay with `4242 4242 4242 4242`, any future date, any CVC.
3. `/checkout/success` asks the backend to retrieve the session; only `payment_status = paid` in test mode for our product unlocks content.

### Stripe: charity donations (Checkout + Connect)
1. Put your test secret key in `STRIPE_SECRET_KEY` (no publishable key needed: Checkout is hosted by Stripe).
2. Click **Donate (test)**, pick a charity, enter an amount on Stripe's page and pay with `4242 4242 4242 4242`. Stripe sends you back to `/?donation=done&session_id=…`; the server retrieves the session (with its PaymentIntent and charge) and the popup shows only what Stripe reports: paid or not, and a transfer id only if the charge has one.
3. To route each charity's payments to its own test account: in the Stripe Dashboard (test mode) open **Connect → Settings → Platform profile** and review the "responsibilities of managing losses" (Stripe refuses to create connected accounts until then), then run `npm run stripe:create-charities -w server`. It creates four test accounts prefilled with Stripe's test verification data and prints `STRIPE_CHARITY_*` lines for `.env`. Restart; the popup marks routed charities.

The browser sends only a charity id; amount limits (`DONATION_MIN_CENTS`/`MAX`) live on a Stripe Price with a customer-chosen amount, and destinations come only from server config and are used only if Stripe reports `transfers: active`. These are stand-in test accounts, **not** the real organisations; each card links to the organisation's own site for real giving.

### Stripe: legacy single-charity donation (Payment Element, not used by the popup)
1. Enable Connect for your test account in the Dashboard (Connect → Get started).
2. Put the test **publishable** key in `STRIPE_PUBLISHABLE_KEY`.
3. Create the stand-in charity: `npm run stripe:create-charity -w server` (set `CHARITY_COUNTRY`, default `IE`, if needed). It creates a test Express account with the `transfers` capability and prints an onboarding link. Complete onboarding with Stripe's test data, then set `STRIPE_CONNECTED_ACCOUNT_ID`. Rerun with `-- acct_…` to get a fresh onboarding link.
4. Forward webhooks:
   ```bash
   stripe listen --forward-to localhost:<PORT>/api/stripe/webhook \
     --events payment_intent.succeeded,payment_intent.processing,payment_intent.payment_failed,payment_intent.canceled,charge.refunded,transfer.created,checkout.session.completed,checkout.session.async_payment_succeeded
   ```
   Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` and restart.
5. Click **Donate (test)** in the header, choose an amount, pay with `4242 4242 4242 4242`.

**Charge type: destination charge.** The server creates a PaymentIntent on the platform with `transfer_data.destination` set to `STRIPE_CONNECTED_ACCOUNT_ID`; Stripe charges the card on the platform and automatically transfers the full amount to the connected account (no application fee). The platform is the merchant of record and bears refunds and disputes. The destination comes only from server config; requests with any extra field (such as a destination) are rejected. Amount and currency are validated on the server; a client idempotency key prevents duplicate PaymentIntents on double clicks.

**Status is webhook-only.** The browser's `confirmPayment` result is never shown as success. The dialog polls `GET /api/donations/:id`, which changes only when a signature-verified webhook arrives: `payment_intent.*` sets the payment state, `transfer.created` (matched by the charge id) records the transfer to the charity, `charge.refunded` marks refunds. Webhook objects are ignored unless they are test mode, carry our donation metadata, and target the configured account. The UI says "transfer recorded" only after `transfer.created`.

If the connected account cannot receive transfers yet, `/api/donations/config` reports it and the dialog disables donating.

### API
| Route | Notes |
|---|---|
| `GET /api/hazards?range=24h\|7d\|30d\|90d\|365d` or `?start=YYYY-MM-DD&end=YYYY-MM-DD` | Optional `categories`, `sources` (csv), `minMagnitude`, `refresh=1`. Returns events plus per-provider status and limitations |
| `GET /api/news?country=XX` / `?scope=global` | Google News RSS headlines, 10-minute cache |
| `POST /api/safety {latitude, longitude, radiusKm: 100\|250\|500\|1000, window: 7d\|30d, region?}` | Rate-limited (AI) |
| `GET /api/charities` · `POST /api/charities/checkout {charityId}` · `GET /api/charities/donation/:cs_test_id` | Donate popup. Rate-limited |
| `GET /api/donations/config` · `POST /api/donations {amountCents, currency, idempotencyKey}` · `GET /api/donations/:pi_id` | Legacy Payment Element flow. Rate-limited |
| `GET /api/events`, `GET /api/events/:id`, `POST /api/briefings`, `GET /api/resources`, checkout and preparedness routes | Unchanged earthquake features |
| `POST /api/stripe/webhook` | Raw body, signature verified |

Errors use `{ "error": { "code", "message" } }`.

## Data and attribution
- USGS Earthquake Hazards Program, FDSN event web service (https://earthquake.usgs.gov/fdsnws/event/1/).
- NASA Earth Observatory Natural Event Tracker (EONET) v3 (https://eonet.gsfc.nasa.gov/). EONET curates events reported by other agencies (GDACS, IRWIN, JTWC and others); IMPACT shows the cited agency for each record. Positions are reported points or polygon centres, not fire perimeters or flood extents. Many EONET wildfire records come from GDACS and stay open after the fire ends.
- Google News RSS search for headlines.
- Armed conflict countries: Wikipedia, [List of ongoing armed conflicts](https://en.wikipedia.org/wiki/List_of_ongoing_armed_conflicts). A community-maintained list, not an official designation.
- Quake marker colours depend on magnitude only and are **not** a humanitarian-severity score. Times are shown in your browser's time zone; custom ranges are UTC days.

## AI grounding and limits
Both AI features receive only server-built context and are told to treat it as untrusted data.
- **Briefings:** the facts block comes from USGS, not the model; the model adds labelled interpretation, gaps and general considerations.
- **Safety planner:** the context is the pin (rounded to 0.01°), radius, time window, up to 25 nearest events (category, title, distance, size, time, source names), provider status and limitations. The model must not invent disasters, evacuation orders, shelters, phone numbers or official instructions, and must never call an area safe. Output is validated with zod, and any hazard section for a category not present in the events, or citing an event reference that does not exist, is dropped. With no nearby events the AI is not called and the panel says this does not mean the area is safe. With no key, a timeout or an error, the panel still shows the event facts, limitations and official links (GDACS, WMO, ReliefWeb, plus USGS, Smithsonian GVP, GWIS or the ICRC when relevant). A disclaimer is always visible.
- **History:** the record sent to the model is a server-written summary per hazard (counts, years, largest or most recent events with distances). The model may say the area *has a record of* a hazard and suggest what to watch for and how to prepare, but must not predict events, give probabilities or invent past events. Each "watch for" section is kept only if its hazard is in the record, and the factual line shown above it is the server's, not the model's. Potential issues are framed as possible, not certain. Location from **Use my location** is rounded to about 100 m before it reaches the server and about 1 km before it reaches the model, and is not stored.
- **Conflict near a pin:** if the pin's country is on Wikipedia's current-conflict list, the panel shows that country name and the ICRC link. The model may give only general personal-safety practice; it must not claim territorial control, predict attacks or name safe routes.

## Verification status
| Item | Status |
|---|---|
| Server and client TypeScript, client production build | Passing |
| Server tests (97 cases across USGS, EONET normalisation, windows, matching, hazards route, ACLED/UCDP normalisation, login, cursor paging and failures, news parsing, safety context and fallbacks including conflict, notification rules, Stripe Checkout, donation validation, webhook state and signature verification) | Passing, all external APIs mocked |
| Live ACLED and UCDP | **Not verified** here (no credentials). Endpoints and fields follow the published API docs; field names are checked again by the normaliser, and unknown shapes are reported as errors |
| Live USGS, EONET and Google News | Checked against the real services: 7 days ≈ 400 events in ~2 s; 365 days ≈ 17,000 events in ~30 s first load, 0.3 s cached |
| Globe, filters, country news, safety planner, notification preferences, donation dialog, hide-on-panel controls, Conflict tab (unconfigured state) | Checked in a browser |
| Real OpenRouter call | Verified: safety guidance with history for Tokyo in about 20 s via the free fallback (the configured account has no credits for `openai/gpt-4o`, which returns 402) |
| Stripe charity Checkout | Verified against the test account: charities listed, Checkout sessions created, Stripe page opens with the €1–€500 limits. Connected-account routing **not verified** (account creation is blocked until the Dashboard platform-profile step) |
| Webhooks | Not verified (no `stripe listen` session) |
| Automated client UI tests | None |

Known limitations: the globe chunk is about 2 MB (lazy-loaded); news and notification checks run only while the page is open; donation statuses and entitlements are single-instance JSON files; there is no account system.

## Troubleshooting
Blank globe: needs WebGL (the list still works). Long ranges slow: the first one-year load fetches about 13 windows from EONET. A provider banner: that source failed or is stale; the other source still shows. Donation "unavailable": the dialog names the missing setting. Donation stuck on "waiting for webhook": `stripe listen` is not running or `STRIPE_WEBHOOK_SECRET` is wrong. Stripe returns to the wrong port: `CLIENT_URL` must match the URL you open.
