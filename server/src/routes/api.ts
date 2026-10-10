import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_FEED, isFeedId, isHazardCategory, isProvider, resolveRange, type HealthResponse, type HazardCategory, type Provider } from '../../../shared/types';
import { getConfig } from '../config';
import { HttpError } from '../errors';
import { checkoutLimiter, aiLimiter, newsLimiter, smsLimiter } from '../middleware/rateLimit';
import { wrap } from '../middleware/errors';
import { generateBriefing } from '../services/briefing';
import { CreateDonationSchema, PaymentIntentIdSchema, createDonation, donationProblem, getDonationConfig, getDonationStatus } from '../services/donation';
import type { DonationStore } from '../services/donationStore';
import { CharityCheckoutSchema, CharitySessionIdSchema, createCharityCheckout, getCharityDonation, listCharities } from '../services/charities';
import type { EntitlementStore } from '../services/entitlements';
import { getConflictCountries } from '../services/conflictCountries';
import { getHazards } from '../services/hazards';
import { SmsCancelSchema, SmsSubscribeSchema, cancelSms, subscribeSms, twilioConfigured } from '../services/sms';
import { getCountryNews, getGlobalNews } from '../services/news';
import { SafetyRequestSchema, planSafety } from '../services/safety';
import { buildPreparednessPackage } from '../services/preparedness';
import { GENERAL_RESOURCES } from '../services/resources';
import { CreateSessionSchema, SessionIdSchema, createCheckoutSession, getProduct, stripeProblem, verifySession } from '../services/stripe';
import type Stripe from 'stripe';
import { getEventById, getEvents } from '../services/usgs';

export interface ApiDeps { store: EntitlementStore; donations: DonationStore; stripe: () => Stripe | null }

const EventIdSchema = z.string().regex(/^[a-z0-9]{4,40}$/i);
const CountrySchema = z.string().regex(/^[A-Za-z]{2}$/);
const optStr = z.string().max(200).optional();
const HazardQuerySchema = z.object({
  range: optStr, start: optStr, end: optStr, refresh: optStr,
  minMagnitude: z.coerce.number().min(0).max(10).optional(),
  categories: optStr, sources: optStr,
});

function csv<T extends string>(raw: string | undefined, guard: (v: unknown) => v is T, what: string): T[] | undefined {
  if (raw === undefined || raw === '') return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = items.find((i) => !guard(i));
  if (bad) throw new HttpError(400, 'invalid_filter', `Unknown ${what}: ${bad.slice(0, 40)}`);
  return [...new Set(items)] as T[];
}

export function apiRouter({ store, donations, stripe }: ApiDeps) {
  const r = Router();

  r.get('/health', (_req, res) => {
    const cfg = getConfig();
    const problem = stripeProblem();
    const body: HealthResponse = {
      status: 'ok', time: Date.now(),
      openrouter: { configured: Boolean(cfg.openrouter.apiKey), model: cfg.openrouter.model },
      stripe: { configured: !problem, testMode: true, webhookConfigured: Boolean(cfg.stripe.webhookSecret), ...(problem ? { problem } : {}) },
      twilio: { configured: twilioConfigured() },
      product: getProduct(),
    };
    res.json(body);
  });

  r.get('/events', wrap(async (req, res) => {
    const feed = req.query.feed === undefined ? DEFAULT_FEED : req.query.feed;
    if (!isFeedId(feed)) throw new HttpError(400, 'invalid_feed', 'Unknown feed.');
    const data = await getEvents(feed, { force: req.query.refresh === '1' });
    const min = req.query.minMagnitude === undefined ? 0 : Number(req.query.minMagnitude);
    if (!Number.isFinite(min) || min < 0 || min > 10) throw new HttpError(400, 'invalid_min_magnitude', 'minMagnitude must be between 0 and 10.');
    const limit = req.query.limit === undefined ? 5000 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new HttpError(400, 'invalid_limit', 'limit must be an integer from 1 to 5000.');
    const events = data.events.filter((e) => min === 0 || (e.magnitude !== null && e.magnitude >= min)).slice(0, limit);
    res.json({ events, meta: { ...data.meta, count: events.length } });
  }));

  r.get('/hazards', wrap(async (req, res) => {
    const parsed = HazardQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'The hazard query was not valid.');
    const p = parsed.data;
    let range;
    try { range = resolveRange({ preset: p.range, start: p.start, end: p.end }); }
    catch (err) { throw new HttpError(400, 'invalid_range', (err as Error).message); }
    const categories = csv<HazardCategory>(p.categories, isHazardCategory, 'category');
    const providers = csv<Provider>(p.sources, isProvider, 'source') ?? ['usgs', 'eonet', 'acled', 'ucdp'];
    res.json(await getHazards({ range, minMagnitude: p.minMagnitude ?? 0, providers, categories, force: p.refresh === '1' }));
  }));

  r.get('/events/:id', wrap(async (req, res) => {
    const id = EventIdSchema.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'invalid_event_id', 'Event id is not valid.');
    const event = await getEventById(id.data);
    if (!event) throw new HttpError(404, 'event_not_found', 'No event with that id.');
    res.json({ event });
  }));

  r.post('/briefings', aiLimiter, wrap(async (req, res) => {
    const { eventId } = z.object({ eventId: EventIdSchema }).strict().parse(req.body);
    const event = await getEventById(eventId); // facts always come from USGS, never from the browser
    if (!event) throw new HttpError(404, 'event_not_found', 'No event with that id.');
    res.json(await generateBriefing(event));
  }));

  r.get('/news', newsLimiter, wrap(async (req, res) => {
    const force = req.query.refresh === '1';
    if (req.query.scope === 'global' && req.query.country === undefined) { res.json(await getGlobalNews({ force })); return; }
    const country = CountrySchema.safeParse(req.query.country);
    if (!country.success) throw new HttpError(400, 'invalid_country', 'Use a two-letter ISO country code, or scope=global.');
    res.json(await getCountryNews(country.data, { force }));
  }));

  r.post('/safety', aiLimiter, wrap(async (req, res) => {
    const parsed = SafetyRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_safety_request', 'Provide latitude, longitude, a supported radius (100, 250, 500 or 1000 km) and a window of 7d or 30d.');
    res.json(await planSafety(parsed.data));
  }));

  r.get('/conflicts', wrap(async (req, res) => {
    res.json(await getConflictCountries({ force: req.query.refresh === '1' }));
  }));

  r.post('/alerts/sms', smsLimiter, wrap(async (req, res) => {
    const parsed = SmsSubscribeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_sms_request', 'Provide an E.164 phone number (+ and country code), latitude, longitude and a supported radius.');
    res.json(await subscribeSms(parsed.data));
  }));

  r.post('/alerts/sms/cancel', smsLimiter, wrap(async (req, res) => {
    const parsed = SmsCancelSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_sms_request', 'Provide the same E.164 phone number used to subscribe.');
    res.json(cancelSms(parsed.data.phone));
  }));

  r.get('/resources', (_req, res) => {
    res.json({
      general: GENERAL_RESOURCES,
      incidentSpecificDonation: { verified: false, message: 'IMPACT has not verified an incident-specific donation page for any event. Use the organisations above directly.' },
    });
  });

  r.post('/checkout/create-session', checkoutLimiter, wrap(async (req, res) => {
    const input = CreateSessionSchema.parse(req.body);
    const client = stripe();
    if (!client) throw new HttpError(503, 'stripe_not_configured', stripeProblem() ?? 'Stripe is not configured.');
    try {
      res.json(await createCheckoutSession(client, input));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, 'checkout_failed', 'Stripe could not create the checkout session. Check your test keys and try again.');
    }
  }));

  r.get('/checkout/session/:sessionId', checkoutLimiter, wrap(async (req, res) => {
    const id = SessionIdSchema.safeParse(req.params.sessionId);
    if (!id.success) throw new HttpError(400, 'invalid_session_id', 'Session id is not valid.');
    const client = stripe();
    if (!client) throw new HttpError(503, 'stripe_not_configured', stripeProblem() ?? 'Stripe is not configured.');
    res.json(await verifySession(client, store, id.data));
  }));

  r.get('/charities', checkoutLimiter, wrap(async (_req, res) => {
    res.json(await listCharities(stripeProblem() ? null : stripe()));
  }));

  r.post('/charities/checkout', checkoutLimiter, wrap(async (req, res) => {
    const parsed = CharityCheckoutSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_charity', 'Send a known charityId only.');
    const client = stripeProblem() ? null : stripe();
    if (!client) throw new HttpError(503, 'stripe_not_configured', stripeProblem() ?? 'Stripe is not configured.');
    res.json(await createCharityCheckout(client, parsed.data.charityId));
  }));

  r.get('/charities/donation/:sessionId', checkoutLimiter, wrap(async (req, res) => {
    const id = CharitySessionIdSchema.safeParse(req.params.sessionId);
    if (!id.success) throw new HttpError(400, 'invalid_session_id', 'Session id is not valid.');
    const client = stripeProblem() ? null : stripe();
    if (!client) throw new HttpError(503, 'stripe_not_configured', stripeProblem() ?? 'Stripe is not configured.');
    res.json(await getCharityDonation(client, id.data));
  }));

  r.get('/donations/config', checkoutLimiter, wrap(async (_req, res) => {
    res.json(await getDonationConfig(donationProblem() ? null : stripe()));
  }));

  r.post('/donations', checkoutLimiter, wrap(async (req, res) => {
    const parsed = CreateDonationSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_donation', 'Send amountCents (integer), currency and idempotencyKey only.');
    const problem = donationProblem();
    const client = problem ? null : stripe();
    if (!client) throw new HttpError(503, 'donation_not_configured', problem ?? 'Stripe is not configured.');
    res.json(await createDonation(client, donations, parsed.data));
  }));

  r.get('/donations/:id', wrap(async (req, res) => {
    const id = PaymentIntentIdSchema.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'invalid_donation_id', 'Donation id is not valid.');
    res.json(getDonationStatus(donations, id.data));
  }));

  // Premium content: only served for sessions the server has verified as paid.
  r.get('/preparedness/:sessionId', wrap(async (req, res) => {
    const sid = SessionIdSchema.safeParse(req.params.sessionId);
    const eid = EventIdSchema.safeParse(req.query.eventId);
    if (!sid.success || !eid.success) throw new HttpError(400, 'invalid_request', 'Session id or event id is not valid.');
    if (!store.has(sid.data)) throw new HttpError(402, 'payment_required', 'No verified purchase for this session.');
    const event = await getEventById(eid.data);
    if (!event) throw new HttpError(404, 'event_not_found', 'No event with that id.');
    res.json({ package: buildPreparednessPackage(event) });
  }));

  return r;
}
