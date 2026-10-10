/**
 * Creates four TEST-MODE connected accounts standing in for the charities in the Donate dialog
 * (IFRC, MSF, UNICEF, WFP), filled with Stripe's test verification data so they can receive transfers
 * without manual onboarding.
 *
 *   npm run stripe:create-charities -w server
 *
 * Prerequisite (once, in the Stripe Dashboard, test mode): Connect → Settings → Platform profile →
 * review "responsibilities of managing losses". Stripe refuses to create accounts until then.
 * Refuses to run with a live key. These accounts are not the real organisations.
 */
import Stripe from 'stripe';
import { getConfig } from '../src/config';
import { CHARITY_IDS } from '../src/services/charities';
import { stripeProblem } from '../src/services/stripe';

const problem = stripeProblem();
if (problem) {
  console.error(problem);
  process.exit(1);
}
const stripe = new Stripe(getConfig().stripe.secretKey);
const NAMES: Record<string, string> = { ifrc: 'IFRC', msf: 'MSF', unicef: 'UNICEF', wfp: 'WFP' };
const lines: string[] = [];

for (const id of CHARITY_IDS) {
  try {
    const account = await stripe.accounts.create({
      type: 'custom',
      country: 'IE',
      email: `impact-test-${id}@example.com`,
      business_type: 'non_profit',
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
      company: {
        name: `IMPACT test stand-in for ${NAMES[id]}`,
        tax_id: 'IE1234567T',
        phone: '+353000000000',
        // Stripe test-mode magic value that passes address verification.
        address: { line1: 'address_full_match', city: 'Dublin', postal_code: 'D02 X285', country: 'IE' },
      },
      business_profile: { mcc: '8398', url: 'https://stripe.com', product_description: `Test-mode stand-in for ${NAMES[id]} in the IMPACT demo. Not the real organisation.` },
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
      // Stripe's documented test IBAN for Ireland.
      external_account: { object: 'bank_account', country: 'IE', currency: 'eur', account_number: 'IE29AIBK93115212345678' } as unknown as string,
      metadata: { purpose: 'impact_test_charity', charity: id },
    });
    console.log(`${id}: ${account.id} transfers=${account.capabilities?.transfers ?? 'unknown'} due=${account.requirements?.currently_due?.join(',') || 'none'}`);
    lines.push(`STRIPE_CHARITY_${id.toUpperCase()}=${account.id}`);
  } catch (err) {
    console.error(`${id}: ${(err as Error).message}`);
  }
}
if (lines.length) console.log(`\nAdd to .env, then restart the server:\n${lines.join('\n')}\n\nAccounts whose transfers capability is still "pending" usually become active within a minute; the Donate dialog shows which charities are routed.`);
