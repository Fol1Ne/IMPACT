import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type Stripe from 'stripe';
import { createApp } from '../src/app';
import { CharityCheckoutSchema, __resetCharityCache, createCharityCheckout, getCharityDonation, listCharities } from '../src/services/charities';
import { DonationStore } from '../src/services/donationStore';
import { EntitlementStore } from '../src/services/entitlements';

const KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_CHARITY_MSF', 'STRIPE_CHARITY_IFRC', 'CLIENT_URL'] as const;

/** Minimal Stripe double recording the calls the charity flow makes. */
function fakeStripe(opts: { active?: Record<string, boolean>; session?: Partial<Stripe.Checkout.Session> } = {}) {
  const calls: { sessions: Stripe.Checkout.SessionCreateParams[]; prices: Stripe.PriceCreateParams[] } = { sessions: [], prices: [] };
  const stripe = {
    accounts: { retrieve: async (id: string) => ({ id, capabilities: { transfers: opts.active?.[id] ? 'active' : 'inactive' } }) },
    prices: {
      list: async () => ({ data: [] }),
      create: async (p: Stripe.PriceCreateParams) => { calls.prices.push(p); return { id: 'price_test_1' }; },
    },
    checkout: {
      sessions: {
        create: async (p: Stripe.Checkout.SessionCreateParams) => { calls.sessions.push(p); return { id: 'cs_test_abc1234567', url: 'https://checkout.stripe.com/c/pay/cs_test_abc1234567' }; },
        retrieve: async () => ({ id: 'cs_test_abc1234567', livemode: false, payment_status: 'paid', status: 'complete', amount_total: 2500, currency: 'eur', metadata: { purpose: 'impact_charity_donation', charity: 'msf' }, payment_intent: null, ...opts.session }),
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

describe('charity donations', () => {
  const saved: Partial<Record<string, string>> = {};
  beforeEach(() => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.CLIENT_URL = 'http://localhost:5173';
    __resetCharityCache();
  });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('lists four charities and marks routing from the account capability, not config alone', async () => {
    process.env.STRIPE_CHARITY_MSF = 'acct_1234567890AB';
    process.env.STRIPE_CHARITY_IFRC = 'acct_INACTIVE1234';
    const { stripe } = fakeStripe({ active: { acct_1234567890AB: true } });
    const r = await listCharities(stripe);
    expect(r.enabled).toBe(true);
    expect(r.charities.map((c) => [c.id, c.routing])).toEqual([['ifrc', 'platform_only'], ['msf', 'connected_account'], ['unicef', 'platform_only'], ['wfp', 'platform_only']]);
  });

  it('creates a donate Checkout session with a customer-chosen amount and a destination charge only for an active account', async () => {
    process.env.STRIPE_CHARITY_MSF = 'acct_1234567890AB';
    const { stripe, calls } = fakeStripe({ active: { acct_1234567890AB: true } });
    const s = await createCharityCheckout(stripe, 'msf');
    expect(s.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const p = calls.sessions[0]!;
    expect(p).toMatchObject({ mode: 'payment', submit_type: 'donate', line_items: [{ price: 'price_test_1', quantity: 1 }], success_url: 'http://localhost:5173/?donation=done&session_id={CHECKOUT_SESSION_ID}' });
    expect(p.payment_intent_data?.transfer_data).toEqual({ destination: 'acct_1234567890AB' });
    expect(calls.prices[0]!.custom_unit_amount).toMatchObject({ enabled: true, minimum: 100, maximum: 50000 });

    await createCharityCheckout(stripe, 'wfp');
    expect(calls.sessions[1]!.payment_intent_data?.transfer_data).toBeUndefined();
    expect(calls.sessions[1]!.metadata).toEqual({ purpose: 'impact_charity_donation', charity: 'wfp' });
  });

  it('accepts only a known charity id and nothing else from the browser', () => {
    expect(CharityCheckoutSchema.safeParse({ charityId: 'msf' }).success).toBe(true);
    expect(CharityCheckoutSchema.safeParse({ charityId: 'evil' }).success).toBe(false);
    expect(CharityCheckoutSchema.safeParse({ charityId: 'msf', destination: 'acct_attacker123' }).success).toBe(false);
    expect(CharityCheckoutSchema.safeParse({ charityId: 'msf', amount: 1 }).success).toBe(false);
  });

  it('reports a transfer only when Stripe has one on the charge', async () => {
    const paid = fakeStripe({ session: { payment_intent: { transfer_data: { destination: 'acct_1234567890AB' }, latest_charge: { transfer: 'tr_123' } } as unknown as Stripe.PaymentIntent } });
    expect(await getCharityDonation(paid.stripe, 'cs_test_abc1234567')).toMatchObject({ paid: true, charityId: 'msf', amountCents: 2500, routedTo: 'acct_1234567890AB', transferId: 'tr_123' });
    const noTransfer = fakeStripe();
    expect(await getCharityDonation(noTransfer.stripe, 'cs_test_abc1234567')).toMatchObject({ paid: true, routedTo: null, transferId: null });
  });

  it('refuses sessions that are not IMPACT test donations', async () => {
    const other = fakeStripe({ session: { metadata: { product: 'enhanced-preparedness' } } });
    await expect(getCharityDonation(other.stripe, 'cs_test_abc1234567')).rejects.toMatchObject({ code: 'donation_not_found' });
    const live = fakeStripe({ session: { livemode: true } });
    await expect(getCharityDonation(live.stripe, 'cs_test_abc1234567')).rejects.toMatchObject({ code: 'donation_not_found' });
  });

  it('rejects malformed checkout requests at the route', async () => {
    const { stripe } = fakeStripe();
    const app = createApp({ store: new EntitlementStore(null), donations: new DonationStore(null), stripe: () => stripe });
    const res = await request(app).post('/api/charities/checkout').send({ charityId: 'msf', destination: 'acct_attacker123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_charity');
    expect((await request(app).get('/api/charities/donation/not-a-session')).status).toBe(400);
  });
});
