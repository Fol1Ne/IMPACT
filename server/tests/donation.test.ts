import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import request from 'supertest';
import { createApp } from '../src/app';
import { __resetCapabilityCache, createDonation, donationProblem, getDonationConfig, handleDonationWebhook } from '../src/services/donation';
import { DonationStore } from '../src/services/donationStore';
import { EntitlementStore } from '../src/services/entitlements';

const ACCT = 'acct_1TestCharity00';
const PI = 'pi_3TestIntent000001';
const KEY = 'abcdef0123456789abcd';
const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_y', STRIPE_CONNECTED_ACCOUNT_ID: ACCT, STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' };
const pi = (over: Record<string, unknown> = {}) => ({
  id: PI, object: 'payment_intent', amount: 1000, currency: 'eur', livemode: false, client_secret: `${PI}_secret_abc`,
  metadata: { purpose: 'impact_donation', destination: ACCT }, transfer_data: { destination: ACCT }, latest_charge: 'ch_1', last_payment_error: null, ...over,
});
const fakeStripe = (transfers = 'active') => ({
  paymentIntents: { create: vi.fn(async (args: { amount: number }) => pi({ amount: args.amount })) },
  accounts: { retrieve: vi.fn(async () => ({ id: ACCT, capabilities: { transfers } })) },
}) as unknown as Stripe;
const evt = (type: string, object: unknown) => ({ id: 'evt_1', type, data: { object } }) as unknown as Stripe.Event;

beforeEach(() => { Object.assign(process.env, env); __resetCapabilityCache(); });
afterEach(() => { for (const k of Object.keys(env)) delete process.env[k]; });

describe('donation configuration', () => {
  it('refuses live or missing keys and bad account ids', () => {
    expect(donationProblem()).toBeNull();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_y';
    expect(donationProblem()).toMatch(/test-mode/);
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_y';
    process.env.STRIPE_CONNECTED_ACCOUNT_ID = 'acct_x';
    expect(donationProblem()).toMatch(/does not look like/);
    delete process.env.STRIPE_CONNECTED_ACCOUNT_ID;
    expect(donationProblem()).toMatch(/not set/);
  });
  it('disables donations until the charity can receive transfers', async () => {
    expect((await getDonationConfig(fakeStripe('active'))).enabled).toBe(true);
    __resetCapabilityCache();
    const c = await getDonationConfig(fakeStripe('inactive'));
    expect(c).toMatchObject({ enabled: false, chargeType: 'destination' });
    expect(c.problem).toMatch(/onboarding/);
  });
  it('never exposes the secret key', async () => {
    expect(JSON.stringify(await getDonationConfig(fakeStripe()))).not.toContain('sk_test_x');
  });
});

describe('creating a donation', () => {
  it('uses a destination charge to the configured account only', async () => {
    const stripe = fakeStripe();
    const r = await createDonation(stripe, new DonationStore(null), { amountCents: 2500, currency: 'EUR', idempotencyKey: KEY });
    const [args, opts] = (stripe.paymentIntents.create as unknown as { mock: { calls: [Stripe.PaymentIntentCreateParams, Stripe.RequestOptions][] } }).mock.calls[0]!;
    expect(args).toMatchObject({ amount: 2500, currency: 'eur', transfer_data: { destination: ACCT }, automatic_payment_methods: { enabled: true } });
    expect(opts.idempotencyKey).toBe(`donation-${KEY}`);
    expect(r.donation).toMatchObject({ state: 'awaiting_payment', webhookConfirmed: false, transfer: null });
  });
  it('validates amount and currency on the server', async () => {
    const s = new DonationStore(null);
    await expect(createDonation(fakeStripe(), s, { amountCents: 50, currency: 'eur', idempotencyKey: KEY })).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(createDonation(fakeStripe(), s, { amountCents: 50_001, currency: 'eur', idempotencyKey: KEY })).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(createDonation(fakeStripe(), s, { amountCents: 1000, currency: 'usd', idempotencyKey: KEY })).rejects.toMatchObject({ code: 'invalid_currency' });
  });
  it('rejects a client-chosen destination', async () => {
    const app = createApp({ store: new EntitlementStore(null), donations: new DonationStore(null), stripe: () => fakeStripe() });
    const res = await request(app).post('/api/donations').send({ amountCents: 1000, currency: 'eur', idempotencyKey: KEY, destination: 'acct_attacker000' });
    expect(res.body.error.code).toBe('invalid_donation');
  });
});

describe('webhook-driven status', () => {
  it('only marks success and transfer from webhooks for our donation', () => {
    const s = new DonationStore(null);
    expect(handleDonationWebhook(evt('payment_intent.succeeded', pi({ transfer_data: { destination: 'acct_other0000' } })), s).updated).toBe(false);
    expect(handleDonationWebhook(evt('payment_intent.succeeded', pi({ livemode: true })), s).updated).toBe(false);
    expect(handleDonationWebhook(evt('payment_intent.succeeded', pi()), s).updated).toBe(true);
    expect(s.get(PI)).toMatchObject({ state: 'succeeded', webhookConfirmed: true, transfer: null });
    handleDonationWebhook(evt('transfer.created', { id: 'tr_1', livemode: false, destination: ACCT, source_transaction: 'ch_1' }), s);
    expect(s.get(PI)!.transfer).toEqual({ id: 'tr_1', destination: ACCT });
  });
  it('does not regress a succeeded donation, and records refunds', () => {
    const s = new DonationStore(null);
    handleDonationWebhook(evt('payment_intent.succeeded', pi()), s);
    handleDonationWebhook(evt('payment_intent.processing', pi()), s);
    expect(s.get(PI)!.state).toBe('succeeded');
    handleDonationWebhook(evt('charge.refunded', { id: 'ch_1', livemode: false, refunded: true, payment_intent: PI }), s);
    expect(s.get(PI)!.state).toBe('refunded');
  });
  it('records failures with Stripe’s message', () => {
    const s = new DonationStore(null);
    handleDonationWebhook(evt('payment_intent.payment_failed', pi({ last_payment_error: { message: 'Your card was declined.' } })), s);
    expect(s.get(PI)).toMatchObject({ state: 'failed', lastError: 'Your card was declined.' });
  });
  it('verifies signatures end to end', async () => {
    const donations = new DonationStore(null);
    const app = createApp({ store: new EntitlementStore(null), donations, stripe: () => fakeStripe() });
    const payload = JSON.stringify(evt('payment_intent.succeeded', pi()));
    const forged = await request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('stripe-signature', 't=1,v1=bad').send(payload);
    expect(forged.status).toBe(400);
    expect(donations.get(PI)).toBeUndefined();
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
    const ok = await request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('stripe-signature', header).send(payload);
    expect(ok.status).toBe(200);
    expect((await request(app).get(`/api/donations/${PI}`)).body).toMatchObject({ state: 'succeeded', webhookConfirmed: true });
  });
});
