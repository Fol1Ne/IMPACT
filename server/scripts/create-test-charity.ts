/**
 * Creates (or re-links) a TEST-MODE Express connected account that stands in for a charity.
 *
 *   npm run stripe:create-charity -w server                 # create a new account
 *   npm run stripe:create-charity -w server -- acct_123...  # new onboarding link for an existing one
 *
 * Open the printed link and complete onboarding with Stripe's test data, then put the
 * account id in STRIPE_CONNECTED_ACCOUNT_ID. Refuses to run with a live key.
 */
import Stripe from 'stripe';
import { getConfig } from '../src/config';
import { stripeProblem } from '../src/services/stripe';

const problem = stripeProblem();
if (problem) {
  console.error(problem);
  process.exit(1);
}
const cfg = getConfig();
const stripe = new Stripe(cfg.stripe.secretKey);
const existing = process.argv[2];
const country = (process.env.CHARITY_COUNTRY || 'IE').toUpperCase();

const account = existing
  ? await stripe.accounts.retrieve(existing)
  : await stripe.accounts.create({
    type: 'express',
    country,
    business_type: 'non_profit',
    capabilities: { transfers: { requested: true } },
    business_profile: { name: cfg.donation.charityName, product_description: 'Test-mode stand-in charity for the IMPACT demo. Not a real organisation.' },
    metadata: { purpose: 'impact_test_charity' },
  });
const link = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: `${cfg.clientUrl}/?connect=refresh`,
  return_url: `${cfg.clientUrl}/?connect=return`,
  type: 'account_onboarding',
});

console.log(`\nTest charity account: ${account.id} (${account.country})`);
console.log(`Transfers capability: ${account.capabilities?.transfers ?? 'not requested'}`);
console.log(`\n1. Complete onboarding with Stripe test data:\n   ${link.url}`);
console.log(`2. Add to .env:\n   STRIPE_CONNECTED_ACCOUNT_ID=${account.id}\n3. Restart the server.\n`);
