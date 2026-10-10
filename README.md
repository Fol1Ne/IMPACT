# IMPACT — Global Disaster Intelligence. Humanitarian Action.

HackUCD 2026 submission. IMPACT puts real USGS earthquake data on an interactive 3D globe, lets you open an event, generate a **grounded AI briefing** (OpenRouter), find **official humanitarian resources**, and buy a **sandbox-only** "Enhanced Preparedness Briefing" through **Stripe Checkout** that unlocks only after the backend verifies payment with Stripe.

> IMPACT is an independent information platform, **not** an official emergency service. The Stripe purchase is a software demo, **not a donation**.

## Problem and idea
After a disaster, people see alarming headlines but struggle to separate confirmed facts from speculation, and to find trustworthy places to learn or help. IMPACT shows only what the source confirms, labels AI interpretation separately, states what is unknown, and links to official organisations.

## Features
- USGS GeoJSON feeds (6 selectable windows), normalised on the server, with fetch time, feed coverage, manual refresh and an explicit **stale-data** banner when cached data is shown.
- 3D globe (react-globe.gl, lazy-loaded) with a synchronised event list, filters (window, min magnitude, sort, text search), recent-events strip, zoom/reset controls, reduced-motion support and a mobile layout.
- Event panel with source-supported facts only (magnitude, depth, time, coordinates, USGS link; PAGER/tsunami/felt only when USGS provides them).
- AI briefing: the facts block is built by the server from USGS, not by the model; the model adds clearly labelled interpretation, gaps and general considerations. Cached per event version + model; the UI says "generated just now" or "served from server cache".
- Resources: the event's USGS page, plus a clearly labelled **general** catalogue. No incident-specific donation page is claimed.
- Stripe test-mode Checkout (server-created session, server-side price), return pages that call the backend, optional signed webhook, idempotent entitlement, unlocked content served only to verified sessions.

## Stack
React + TypeScript + Vite · react-globe.gl · Node + Express (TypeScript, run with `tsx`) · zod · helmet · express-rate-limit · Stripe SDK · Vitest + Supertest. One npm-workspaces repo (`client`, `server`, `shared`). No database: verified Stripe session ids are kept in `server/data/entitlements.json` (no personal data).

## Structure
```
client/  src/{components,hooks,lib,styles}, public/textures (globe images from the three-globe package, MIT)
server/  src/{routes,services,middleware}, tests/
shared/  types.ts (types + pure helpers used by both sides)
.env.example  README.md  package.json
```

## Setup
Prerequisites: Node.js 20+ and npm.
```bash
npm install
cp .env.example .env      # then edit .env
npm run dev               # server :3001 + client :5173 -> open http://localhost:5173
```
Single-port mode: set `CLIENT_URL=http://localhost:3001` in `.env`, then `npm start` (builds the client, serves everything from :3001).

Other scripts: `npm test` (server tests), `npm run typecheck`, `npm run build`.

### Environment variables (root `.env`)
| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 3001) |
| `CLIENT_URL` | Browser origin; used for CORS and Stripe return URLs |
| `OPENROUTER_API_KEY` | Server-only key. Without it, briefings show a configuration message |
| `OPENROUTER_MODEL` | Model id. The default `openai/gpt-4o-mini` is **not verified** against the live catalogue; pick one from openrouter.ai/models |
| `STRIPE_SECRET_KEY` | **Test** key (`sk_test_…`). Live keys are refused |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the Stripe CLI (optional) |
| `PRODUCT_PRICE_CENTS`, `PRODUCT_CURRENCY` | Default 500 / eur |

Secrets never reach the browser; `/api/health` reports only booleans.

### OpenRouter
Create a key at https://openrouter.ai/keys, set `OPENROUTER_API_KEY`, choose `OPENROUTER_MODEL`, restart. If the model is unavailable the UI shows a retryable error naming the setting to check.

### Stripe (sandbox)
1. Stripe Dashboard → **Test mode** → Developers → API keys → copy the secret key into `STRIPE_SECRET_KEY`.
2. Select an event → **Preparedness** tab → *Unlock*. Pay with `4242 4242 4242 4242`, any future expiry, any CVC (https://docs.stripe.com/testing).
3. You return to `/checkout/success`, which asks the backend to retrieve the session from Stripe. Only `payment_status = paid` (test mode, our product metadata) unlocks content.
4. Webhook (recommended): `stripe listen --forward-to localhost:3001/api/stripe/webhook`, copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`, restart. Signatures are verified and repeated events do not re-grant.

### API
`GET /api/health` · `GET /api/events?feed=&minMagnitude=&limit=&refresh=1` · `GET /api/events/:id` · `POST /api/briefings {eventId}` · `GET /api/resources` · `POST /api/checkout/create-session {product,eventId?}` · `GET /api/checkout/session/:id` · `GET /api/preparedness/:sessionId?eventId=` (402 unless verified) · `POST /api/stripe/webhook`. Errors use `{ "error": { "code", "message" } }`. AI and checkout routes are rate-limited.

## Data and attribution
USGS Earthquake Hazards Program GeoJSON summary feeds (https://earthquake.usgs.gov/earthquakes/feed/). Marker colour depends on magnitude only: under 4.5 cyan, 4.5 to 5.9 amber, 6+ red. It is **not** a humanitarian-severity score. Wildfires / NASA FIRMS are not implemented.

## AI grounding and limits
The model receives only the USGS record, is told to treat it as untrusted data, must not state casualties, damage, aid or official responses, and must not give emergency instructions. Output is parsed as JSON and validated with zod; malformed output returns a retryable error. The model cannot browse, so it cannot know real-time conditions. Output is rendered as plain text. Quality varies by model, so review it.

## Payment flow
Browser → `POST /api/checkout/create-session` (server chooses price/currency) → Stripe-hosted Checkout → `/checkout/success?session_id=…` → `GET /api/checkout/session/:id` (server asks Stripe) → entitlement stored → `GET /api/preparedness/:sessionId` serves the package. The webhook is a second grant path. Limitation: no accounts, so the benefit is tied to the session id in this browser's localStorage.

## Verification status
| Item | Status |
|---|---|
| Server and client TypeScript | Type-checked in the build sandbox |
| Server tests (USGS normalisation, staleness, filters, briefing parsing, OpenRouter error mapping, Stripe states, entitlement, webhook idempotency, validation, 402 gating) | Run and passing in the build sandbox, using mocks |
| Client production build | Built in the build sandbox |
| Server start, `/api/health`, SPA serving, 502 when USGS is unreachable, `stripe_not_configured` | Smoke-tested in the sandbox |
| Live USGS feed, real OpenRouter call, Stripe Checkout and webhook, globe in a browser, resource link targets | **Not verified**: the sandbox had no access to those services or a browser. Check them on your machine |
| Automated client UI tests | None |

Known limitations: the globe chunk is about 2 MB (lazy-loaded); resource URLs are homepage-level and not link-checked; the entitlements file suits a single instance; the layout was not reviewed visually in a browser.

## Demo script (about 3 minutes)
1. Problem: "After a quake, facts, speculation and appeals blur together."
2. Open IMPACT: real USGS data; the header shows source, fetch time and window.
3. Click a large event on the globe; the list and panel stay in sync. Show *What we do not know*.
4. Briefing → Generate. Point at the green source-data block versus the blue AI blocks and the limitations.
5. Resources: the event page versus general organisations; no invented donation claim.
6. Preparedness → Unlock, pay with 4242…, show the "Verifying with Stripe" page, then the unlocked package. Explain: server-side price, backend verification, idempotent webhook, sandbox only.
7. Close on responsible AI: the model interprets, unknowns stay unknown.

## Troubleshooting
Blank globe: needs WebGL (the list still works). `502 upstream_unavailable`: USGS unreachable and nothing cached. Checkout "not configured": set a **test** key and restart. Stripe returns to the wrong port: `CLIENT_URL` must match the URL you open. Briefing 502: check `OPENROUTER_MODEL` and the key.
