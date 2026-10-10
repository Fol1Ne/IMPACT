import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_FEED, isFeedId, type HealthResponse } from '../../../shared/types';
import { getConfig } from '../config';
import { HttpError } from '../errors';
import { checkoutLimiter, aiLimiter } from '../middleware/rateLimit';
import { wrap } from '../middleware/errors';
import { generateBriefing } from '../services/briefing';
import type { EntitlementStore } from '../services/entitlements';
import { buildPreparednessPackage } from '../services/preparedness';
import { GENERAL_RESOURCES } from '../services/resources';
import { CreateSessionSchema, SessionIdSchema, createCheckoutSession, getProduct, stripeProblem, verifySession } from '../services/stripe';
import type Stripe from 'stripe';
import { getEventById, getEvents } from '../services/usgs';

export interface ApiDeps { store: EntitlementStore; stripe: () => Stripe | null }

const EventIdSchema = z.string().regex(/^[a-z0-9]{4,40}$/i);

export function apiRouter({ store, stripe }: ApiDeps) {
  const r = Router();

  r.get('/health', (_req, res) => {
    const cfg = getConfig();
    const problem = stripeProblem();
    const body: HealthResponse = {
      status: 'ok', time: Date.now(),
      openrouter: { configured: Boolean(cfg.openrouter.apiKey), model: cfg.openrouter.model },
      stripe: { configured: !problem, testMode: true, webhookConfigured: Boolean(cfg.stripe.webhookSecret), ...(problem ? { problem } : {}) },
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
