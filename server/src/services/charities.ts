import type Stripe from 'stripe';
import { z } from 'zod';
import type { Charity, CharitiesResponse, CharityDonationResult, CharityId } from '../../../shared/types';
import { getConfig } from '../config';
import { HttpError } from '../errors';
import { log } from '../logger';
import { stripeProblem } from './stripe';

const BASE: Record<CharityId, Omit<Charity, 'routing'>> = {
  ifrc: { id: 'ifrc', name: 'IFRC – Red Cross and Red Crescent', focus: 'Disaster response and recovery through national Red Cross and Red Crescent societies.', officialUrl: 'https://www.ifrc.org/' },
  msf: { id: 'msf', name: 'Médecins Sans Frontières (MSF)', focus: 'Emergency medical care in conflicts, epidemics and natural disasters.', officialUrl: 'https://www.msf.org/' },
  unicef: { id: 'unicef', name: 'UNICEF', focus: 'Water, health, nutrition and protection for children in emergencies.', officialUrl: 'https://www.unicef.org/' },
  wfp: { id: 'wfp', name: 'World Food Programme (WFP)', focus: 'Emergency food assistance after disasters and in conflict zones.', officialUrl: 'https://www.wfp.org/' },
};
export const CHARITY_IDS = Object.keys(BASE) as CharityId[];
const PURPOSE = 'impact_charity_donation';
const ACCT = /^acct_[A-Za-z0-9]{8,64}$/;

export const CharityCheckoutSchema = z.object({ charityId: z.enum(CHARITY_IDS as [CharityId, ...CharityId[]]) }).strict();
export const CharitySessionIdSchema = z.string().regex(/^cs_test_[A-Za-z0-9]{10,200}$/);

/** Connected account for a charity, from server config only. Malformed values are ignored. */
const accountFor = (id: CharityId): string | null => {
  const v = getConfig().stripe.charityAccounts[id];
  return v && ACCT.test(v) ? v : null;
};

const capability = new Map<string, { active: boolean; at: number }>();
export const __resetCharityCache = () => { capability.clear(); priceCache.clear(); };

async function transfersActive(stripe: Stripe, account: string): Promise<boolean> {
  const hit = capability.get(account);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.active;
  try {
    const a = await stripe.accounts.retrieve(account);
    const active = a.capabilities?.transfers === 'active';
    capability.set(account, { active, at: Date.now() });
    return active;
  } catch (err) {
    log('warn', 'charity_account_check_failed', { account, reason: (err as Error).message?.slice(0, 120) });
    return false;
  }
}

/** The destination for a charity's donations: its connected account if Stripe says it can receive transfers, else none. */
async function destinationFor(stripe: Stripe, id: CharityId): Promise<string | null> {
  const acct = accountFor(id);
  return acct && (await transfersActive(stripe, acct)) ? acct : null;
}

export async function listCharities(stripe: Stripe | null): Promise<CharitiesResponse> {
  const { currency, minCents, maxCents } = getConfig().donation;
  const problem = stripeProblem();
  const charities = await Promise.all(CHARITY_IDS.map(async (id): Promise<Charity> => ({
    ...BASE[id],
    routing: stripe && !problem && (await destinationFor(stripe, id)) ? 'connected_account' : 'platform_only',
  })));
  return { enabled: !problem, problem, currency, minCents, maxCents, charities };
}

const priceCache = new Map<string, string>();

/** A reusable "customer chooses the amount" Price per charity, found by lookup key or created once. */
async function donationPrice(stripe: Stripe, id: CharityId): Promise<string> {
  const { currency, minCents, maxCents } = getConfig().donation;
  const lookup = `impact_donation_${id}_${currency}_${minCents}_${maxCents}`;
  const cached = priceCache.get(lookup);
  if (cached) return cached;
  const found = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  let price = found.data[0]?.id;
  if (!price) {
    const created = await stripe.prices.create({
      currency,
      lookup_key: lookup,
      custom_unit_amount: { enabled: true, minimum: minCents, maximum: maxCents, preset: Math.min(maxCents, Math.max(minCents, 1000)) },
      product_data: { name: `Test donation: ${BASE[id].name}`, metadata: { purpose: PURPOSE, charity: id } },
      metadata: { purpose: PURPOSE, charity: id },
    });
    price = created.id;
  }
  priceCache.set(lookup, price);
  return price;
}

export async function createCharityCheckout(stripe: Stripe, charityId: CharityId): Promise<{ url: string; id: string }> {
  const cfg = getConfig();
  const charity = BASE[charityId];
  const destination = await destinationFor(stripe, charityId);
  const metadata = { purpose: PURPOSE, charity: charityId, ...(destination ? { destination } : {}) };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      line_items: [{ price: await donationPrice(stripe, charityId), quantity: 1 }],
      success_url: `${cfg.clientUrl}/?donation=done&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cfg.clientUrl}/?donation=cancelled`,
      metadata,
      payment_intent_data: {
        description: `IMPACT test donation for ${charity.name}`,
        metadata,
        // Destination charge to the charity's own test account. The destination comes only from server config.
        ...(destination ? { transfer_data: { destination } } : {}),
      },
    });
    if (!session.url) throw new Error('no url');
    return { url: session.url, id: session.id };
  } catch (err) {
    log('warn', 'charity_checkout_failed', { charityId, reason: (err as Error).message?.slice(0, 200) });
    throw new HttpError(502, 'checkout_failed', 'Stripe could not start the donation checkout. Check the test key.');
  }
}

/** Ask Stripe (not the browser) what happened to a donation Checkout Session. */
export async function getCharityDonation(stripe: Stripe, sessionId: string): Promise<CharityDonationResult> {
  let s: Stripe.Checkout.Session;
  try {
    s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] });
  } catch {
    throw new HttpError(404, 'donation_not_found', 'Stripe has no checkout session with that id.');
  }
  if (s.livemode || s.metadata?.purpose !== PURPOSE) throw new HttpError(404, 'donation_not_found', 'That checkout session is not an IMPACT test donation.');
  const charityId = CHARITY_IDS.includes(s.metadata.charity as CharityId) ? (s.metadata.charity as CharityId) : null;
  const pi = typeof s.payment_intent === 'object' ? s.payment_intent : null;
  const charge = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const dest = pi?.transfer_data?.destination;
  return {
    sessionId: s.id,
    charityId,
    charityName: charityId ? BASE[charityId].name : null,
    paid: s.payment_status === 'paid',
    sessionStatus: s.status,
    amountCents: s.amount_total,
    currency: s.currency,
    routedTo: typeof dest === 'string' ? dest : dest?.id ?? null,
    transferId: charge?.transfer ? (typeof charge.transfer === 'string' ? charge.transfer : charge.transfer.id) : null,
  };
}
