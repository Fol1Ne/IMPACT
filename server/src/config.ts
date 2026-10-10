import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : d;
};

/** Read lazily so tests (and .env edits at startup) always see current values. */
export function getConfig() {
  const env = process.env;
  return {
    port: int(env.PORT, 3001),
    clientUrl: (env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, ''),
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY?.trim() || '',
      // Default is a commonly available low-cost model. It was NOT verified against the live catalogue - set your own.
      model: env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
      timeoutMs: int(env.OPENROUTER_TIMEOUT_MS, 30000),
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY?.trim() || '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || '',
    },
    product: {
      id: 'enhanced-preparedness',
      name: env.PRODUCT_NAME?.trim() || 'IMPACT Enhanced Preparedness Briefing',
      priceCents: int(env.PRODUCT_PRICE_CENTS, 500),
      currency: (env.PRODUCT_CURRENCY?.trim() || 'eur').toLowerCase(),
    },
    entitlementsFile: env.ENTITLEMENTS_FILE?.trim() || path.join(ROOT_DIR, 'server/data/entitlements.json'),
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
