import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : d;
};

const onVercel = (env: NodeJS.ProcessEnv) => Boolean(env.VERCEL);
const publicUrl = (env: NodeJS.ProcessEnv) => {
  if (env.CLIENT_URL) return env.CLIENT_URL.replace(/\/$/, '');
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, '')}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL.replace(/^https?:\/\//, '')}`;
  return 'http://localhost:5173';
};

/** Read lazily so tests (and .env edits at startup) always see current values. */
export function getConfig() {
  const env = process.env;
  const ephemeral = onVercel(env);
  return {
    port: int(env.PORT, 3001),
    clientUrl: publicUrl(env),
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY?.trim() || '',
      // Default is a commonly available low-cost model. It was NOT verified against the live catalogue - set your own.
      model: env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
      // Tried when the primary model answers 402 (no credits) or 404 (model gone). Empty disables the fallback.
      fallbackModel: env.OPENROUTER_FALLBACK_MODEL?.trim() ?? '',
      timeoutMs: int(env.OPENROUTER_TIMEOUT_MS, 30000),
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY?.trim() || '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || '',
      publishableKey: env.STRIPE_PUBLISHABLE_KEY?.trim() || '',
      connectedAccountId: env.STRIPE_CONNECTED_ACCOUNT_ID?.trim() || '',
      // Test connected accounts standing in for each charity (create with `npm run stripe:create-charities -w server`).
      charityAccounts: {
        ifrc: env.STRIPE_CHARITY_IFRC?.trim() || '',
        msf: env.STRIPE_CHARITY_MSF?.trim() || '',
        unicef: env.STRIPE_CHARITY_UNICEF?.trim() || '',
        wfp: env.STRIPE_CHARITY_WFP?.trim() || '',
      },
    },
    donation: {
      charityName: env.DONATION_CHARITY_NAME?.trim() || 'IMPACT Test Relief Fund (Stripe test account)',
      currency: (env.DONATION_CURRENCY?.trim() || 'eur').toLowerCase(),
      minCents: int(env.DONATION_MIN_CENTS, 100),
      maxCents: int(env.DONATION_MAX_CENTS, 50000),
    },
    donationsFile: ephemeral ? null : env.DONATIONS_FILE?.trim() || path.join(ROOT_DIR, 'server/data/donations.json'),
    product: {
      id: 'enhanced-preparedness',
      name: env.PRODUCT_NAME?.trim() || 'IMPACT Enhanced Preparedness Briefing',
      priceCents: int(env.PRODUCT_PRICE_CENTS, 500),
      currency: (env.PRODUCT_CURRENCY?.trim() || 'eur').toLowerCase(),
    },
    entitlementsFile: ephemeral ? null : env.ENTITLEMENTS_FILE?.trim() || path.join(ROOT_DIR, 'server/data/entitlements.json'),
    eonetBaseUrl: (env.NASA_EONET_BASE_URL?.trim() || 'https://eonet.gsfc.nasa.gov/api/v3').replace(/\/$/, ''),
    acled: {
      // myACLED account email and password; exchanged server-side for an OAuth token. Never sent to the browser.
      username: env.ACLED_EMAIL?.trim() || '',
      password: env.ACLED_PASSWORD || '',
      baseUrl: (env.ACLED_BASE_URL?.trim() || 'https://acleddata.com').replace(/\/$/, ''),
    },
    ucdp: {
      token: env.UCDP_ACCESS_TOKEN?.trim() || '',
      baseUrl: (env.UCDP_BASE_URL?.trim() || 'https://ucdpapi.pcr.uu.se').replace(/\/$/, ''),
    },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID?.trim() || '',
      authToken: env.TWILIO_AUTH_TOKEN?.trim() || '',
      fromNumber: env.TWILIO_FROM_NUMBER?.trim() || '',
    },
    smsAlertsFile: ephemeral ? null : env.SMS_ALERTS_FILE?.trim() || path.join(ROOT_DIR, 'server/data/sms-alerts.json'),
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
