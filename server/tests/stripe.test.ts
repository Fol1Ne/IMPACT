import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import request from 'supertest';
import { createApp } from '../src/app';
import { EntitlementStore } from '../src/services/entitlements';
import { CreateSessionSchema, createCheckoutSession, handleWebhookEvent, mapSessionState, stripeProblem, verifySession } from '../src/services/stripe';
import { __resetUsgsCache } from '../src/services/usgs';

const SID = 'cs_test_a1B2c3D4e5F6g7H8';
const session = (over: Record<string, unknown> = {}) => ({ id: SID, status: 'complete', payment_status: 'paid', metadata: { product: 'enhanced-preparedness' }, amount_total: 500, currency: 'eur', livemode: false, ...over });
const fakeStripe = (s: unknown) => ({ checkout: { sessions: { retrieve: vi.fn(async () => s), create: vi.fn(async (args: unknown) => ({ id: SID, url: 'https://checkout.stripe.com/c/pay/x', args })) } } }) as unknown as Stripe;

beforeEach(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.OPENROUTER_API_KEY; __resetUsgsCache(); });
afterEach(() => { delete process.env.STRIPE_SECRET_KEY; });

describe('configuration', () => {
  it('reports missing and non-test keys', () => {
    expect(stripeProblem()).toMatch(/not set/);
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    expect(stripeProblem()).toMatch(/test-mode/);
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(stripeProblem()).toBeNull();
  });
});

describe('checkout request validation', () => {
  it('accepts only the known product and ignores nothing else', () => {
    expect(CreateSessionSchema.safeParse({ product: 'enhanced-preparedness' }).success).toBe(true);
    expect(CreateSessionSchema.safeParse({ product: 'other' }).success).toBe(false);
    expect(CreateSessionSchema.safeParse({ product: 'enhanced-preparedness', amount: 1 }).success).toBe(false); // client price rejected
    expect(CreateSessionSchema.safeParse({ product: 'enhanced-preparedness', eventId: '../x' }).success).toBe(false);
  });
  it('uses the server-side price', async () => {
    const stripe = fakeStripe({});
    await createCheckoutSession(stripe, { product: 'enhanced-preparedness', eventId: 'us7000abcd' });
    const args = (stripe.checkout.sessions.create as unknown as { mock: { calls: [{ line_items: { price_data: { unit_amount: number } }[]; mode: string }][] } }).mock.calls[0]![0];
    expect(args.mode).toBe('payment');
    expect(args.line_items[0]!.price_data.unit_amount).toBe(500);
  });
});

describe('payment state and entitlement', () => {
  it('maps Stripe states', () => {
    expect(mapSessionState({ status: 'complete', payment_status: 'paid' })).toBe('paid');
    expect(mapSessionState({ status: 'open', payment_status: 'unpaid' })).toBe('pending');
    expect(mapSessionState({ status: 'complete', payment_status: 'unpaid' })).toBe('unpaid');
    expect(mapSessionState({ status: 'expired', payment_status: 'unpaid' })).toBe('expired');
  });
  it('unlocks only after a verified paid session', async () => {
    const store = new EntitlementStore(null);
    const pending = await verifySession(fakeStripe(session({ status: 'open', payment_status: 'unpaid' })), store, SID);
    expect(pending).toMatchObject({ state: 'pending', entitled: false });
    const paid = await verifySession(fakeStripe(session()), store, SID);
    expect(paid).toMatchObject({ state: 'paid', entitled: true });
  });
  it('never grants for live-mode or foreign-product sessions', async () => {
    const store = new EntitlementStore(null);
    expect((await verifySession(fakeStripe(session({ livemode: true })), store, SID)).entitled).toBe(false);
    expect((await verifySession(fakeStripe(session({ metadata: { product: 'x' } })), store, SID)).entitled).toBe(false);
  });
  it('webhook grants idempotently', () => {
    const store = new EntitlementStore(null);
    const evt = { type: 'checkout.session.completed', data: { object: session() } } as unknown as Stripe.Event;
    expect(handleWebhookEvent(evt, store)).toEqual({ handled: true, granted: true });
    expect(store.grant(SID)).toBe(false); // already granted: second grant is a no-op
    expect(handleWebhookEvent({ type: 'customer.created', data: { object: {} } } as unknown as Stripe.Event, store).handled).toBe(false);
  });
});

describe('HTTP behaviour without credentials', () => {
  const app = () => createApp({ store: new EntitlementStore(null) });
  it('health never exposes secrets and reports missing config', async () => {
    process.env.OPENROUTER_API_KEY = 'super-secret-value';
    const res = await request(app()).get('/api/health');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-value');
    expect(res.body.stripe.configured).toBe(false);
  });
  it('checkout creation reports missing Stripe config and rejects bad bodies', async () => {
    expect((await request(app()).post('/api/checkout/create-session').send({ product: 'enhanced-preparedness' })).body.error.code).toBe('stripe_not_configured');
    expect((await request(app()).post('/api/checkout/create-session').send({ product: 'x' })).status).toBe(400);
  });
  it('premium content is refused without a verified purchase', async () => {
    const res = await request(app()).get(`/api/preparedness/${SID}?eventId=us7000abcd`);
    expect(res.status).toBe(402);
  });
  it('briefing needs a valid event id; events validates params', async () => {
    expect((await request(app()).post('/api/briefings').send({ eventId: '../../etc' })).status).toBe(400);
    expect((await request(app()).get('/api/events?feed=evil')).status).toBe(400);
    expect((await request(app()).get('/api/nope')).status).toBe(404);
  });
  it('webhook without configuration is refused', async () => {
    expect((await request(app()).post('/api/stripe/webhook').set('Content-Type', 'application/json').send('{}')).status).toBe(503);
  });
});
