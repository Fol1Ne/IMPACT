import type Stripe from 'stripe';
import { z } from 'zod';
import type { DonationConfig, DonationState, DonationStatus } from '../../../shared/types';
import { getConfig } from '../config';
import { HttpError } from '../errors';
import { log } from '../logger';
import type { DonationStore } from './donationStore';
import { stripeProblem } from './stripe';

export const PRESETS_CENTS = [500, 1000, 2500, 5000];
export const PaymentIntentIdSchema = z.string().regex(/^pi_[A-Za-z0-9]{10,200}$/);

/** Reasons the donation flow cannot run, or null when every key looks like a usable test-mode value. */
export function donationProblem(): string | null {
  const s = getConfig().stripe;
  const base = stripeProblem();
  if (base) return base;
  if (!s.publishableKey) return 'STRIPE_PUBLISHABLE_KEY is not set.';
  if (!s.publishableKey.startsWith('pk_test_')) return 'STRIPE_PUBLISHABLE_KEY must be a test-mode key (starting pk_test_). Live keys are refused.';
  if (!s.connectedAccountId) return 'STRIPE_CONNECTED_ACCOUNT_ID is not set. Run `npm run stripe:create-charity -w server` to create a test charity account.';
  if (!/^acct_[A-Za-z0-9]{8,64}$/.test(s.connectedAccountId)) return 'STRIPE_CONNECTED_ACCOUNT_ID does not look like a Stripe account id (acct_...).';
  return null;
}

let capabilityCache: { account: string; active: boolean; at: number } | null = null;
export const __resetCapabilityCache = () => { capabilityCache = null; };

/** Whether the connected account can receive transfers. Cached for 5 minutes; null if it could not be checked. */
async function transfersActive(stripe: Stripe, account: string): Promise<boolean | null> {
  if (capabilityCache && capabilityCache.account === account && Date.now() - capabilityCache.at < 5 * 60_000) return capabilityCache.active;
  try {
    const acct = await stripe.accounts.retrieve(account);
    const active = acct.capabilities?.transfers === 'active';
    capabilityCache = { account, active, at: Date.now() };
    return active;
  } catch (err) {
    log('warn', 'stripe_account_check_failed', { reason: (err as Error).name });
    return null;
  }
}

export async function getDonationConfig(stripe: Stripe | null): Promise<DonationConfig> {
  const cfg = getConfig();
  const problem = donationProblem();
  const active = !problem && stripe ? await transfersActive(stripe, cfg.stripe.connectedAccountId) : null;
  const finalProblem = problem ?? (active === false ? 'The test charity account cannot receive transfers yet. Finish its onboarding (see README) and try again.' : null);
  return {
    enabled: !finalProblem,
    problem: finalProblem,
    publishableKey: problem ? null : cfg.stripe.publishableKey,
    currency: cfg.donation.currency,
    minCents: cfg.donation.minCents,
    maxCents: cfg.donation.maxCents,
    presetsCents: PRESETS_CENTS.filter((p) => p >= cfg.donation.minCents && p <= cfg.donation.maxCents),
    charity: { name: cfg.donation.charityName, accountId: problem ? null : cfg.stripe.connectedAccountId, transfersActive: active },
    chargeType: 'destination',
  };
}

export const CreateDonationSchema = z.object({
  amountCents: z.number().int(),
  currency: z.string().length(3),
  /** Client-generated key so a double click cannot create two PaymentIntents. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
}).strict();

export async function createDonation(stripe: Stripe, store: DonationStore, input: z.infer<typeof CreateDonationSchema>): Promise<{ clientSecret: string; donation: DonationStatus }> {
  const cfg = getConfig();
  const { minCents, maxCents, currency } = cfg.donation;
  if (input.currency.toLowerCase() !== currency) throw new HttpError(400, 'invalid_currency', `Donations are accepted in ${currency.toUpperCase()} only.`);
  if (input.amountCents < minCents || input.amountCents > maxCents) throw new HttpError(400, 'invalid_amount', `Choose an amount between ${minCents / 100} and ${maxCents / 100} ${currency.toUpperCase()}.`);
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      // Destination charge: the platform creates the charge and Stripe transfers the full amount to this account.
      // The destination is fixed by server config and never read from the request.
      transfer_data: { destination: cfg.stripe.connectedAccountId },
      description: `Test donation to ${cfg.donation.charityName}`,
      metadata: { purpose: 'impact_donation', destination: cfg.stripe.connectedAccountId },
    }, { idempotencyKey: `donation-${input.idempotencyKey}` });
  } catch (err) {
    log('warn', 'stripe_donation_create_failed', { reason: (err as Error).name, message: (err as Error).message?.slice(0, 200) });
    throw new HttpError(502, 'donation_failed', 'Stripe could not start the donation. Check the test keys and the connected account.');
  }
  if (!pi.client_secret) throw new HttpError(502, 'donation_failed', 'Stripe did not return a client secret.');
  const existing = store.get(pi.id);
  const donation: DonationStatus = existing ?? { id: pi.id, amountCents: pi.amount, currency: pi.currency, state: 'awaiting_payment', webhookConfirmed: false, transfer: null, lastError: null, updatedAt: Date.now() };
  if (!existing) store.upsert(donation);
  return { clientSecret: pi.client_secret, donation };
}

export function getDonationStatus(store: DonationStore, id: string): DonationStatus {
  const d = store.get(id);
  if (!d) throw new HttpError(404, 'donation_not_found', 'No donation with that id was created by this server.');
  return d;
}

type PiLike = Pick<Stripe.PaymentIntent, 'id' | 'amount' | 'currency' | 'livemode' | 'metadata' | 'transfer_data' | 'latest_charge' | 'last_payment_error'>;

/** A webhook object is only trusted if it is a test-mode PaymentIntent for our donation to our configured account. */
function isOurDonation(pi: PiLike): boolean {
  const dest = getConfig().stripe.connectedAccountId;
  const piDest = typeof pi.transfer_data?.destination === 'string' ? pi.transfer_data.destination : pi.transfer_data?.destination?.id;
  return !pi.livemode && pi.metadata?.purpose === 'impact_donation' && Boolean(dest) && piDest === dest;
}

const idOf = (v: string | { id: string } | null | undefined) => (v == null ? null : typeof v === 'string' ? v : v.id);

export function handleDonationWebhook(event: Stripe.Event, store: DonationStore): { handled: boolean; updated: boolean } {
  const states: Partial<Record<Stripe.Event['type'], DonationState>> = {
    'payment_intent.processing': 'processing',
    'payment_intent.succeeded': 'succeeded',
    'payment_intent.payment_failed': 'failed',
    'payment_intent.canceled': 'canceled',
  };
  const now = Date.now();
  const state = states[event.type];
  if (state) {
    const pi = event.data.object as PiLike;
    if (!isOurDonation(pi)) return { handled: true, updated: false };
    const prev = store.get(pi.id);
    if (prev?.state === 'refunded' || (prev?.state === 'succeeded' && state !== 'succeeded')) return { handled: true, updated: false };
    store.upsert({
      id: pi.id, amountCents: pi.amount, currency: pi.currency, state, webhookConfirmed: true, transfer: prev?.transfer ?? null,
      lastError: state === 'failed' ? (pi.last_payment_error?.message?.slice(0, 200) ?? 'Payment failed.') : null, updatedAt: now,
    }, idOf(pi.latest_charge));
    return { handled: true, updated: true };
  }
  if (event.type === 'transfer.created') {
    const t = event.data.object as Stripe.Transfer;
    const chargeId = idOf(t.source_transaction);
    const d = chargeId ? store.byCharge(chargeId) : undefined;
    const dest = idOf(t.destination);
    if (!d || t.livemode || dest !== getConfig().stripe.connectedAccountId) return { handled: true, updated: false };
    store.upsert({ ...d, transfer: { id: t.id, destination: dest }, updatedAt: now });
    return { handled: true, updated: true };
  }
  if (event.type === 'charge.refunded') {
    const c = event.data.object as Stripe.Charge;
    const d = store.byCharge(c.id) ?? (idOf(c.payment_intent) ? store.get(idOf(c.payment_intent)!) : undefined);
    if (!d || c.livemode || !c.refunded) return { handled: true, updated: false };
    store.upsert({ ...d, state: 'refunded', webhookConfirmed: true, updatedAt: now });
    return { handled: true, updated: true };
  }
  return { handled: false, updated: false };
}
