import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, ROOT_DIR } from './config';
import { errorHandler, notFound } from './middleware/errors';
import { generalLimiter } from './middleware/rateLimit';
import { apiRouter } from './routes/api';
import { webhookHandler } from './routes/webhook';
import { EntitlementStore } from './services/entitlements';
import { getStripe } from './services/stripe';
import type Stripe from 'stripe';

export interface AppDeps { store?: EntitlementStore; stripe?: () => Stripe | null }

export function createApp(deps: AppDeps = {}) {
  const cfg = getConfig();
  const store = deps.store ?? new EntitlementStore(cfg.entitlementsFile);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"],
      },
    },
  }));
  app.use(cors({ origin: cfg.clientUrl }));

  // Webhook needs the raw body, so it is registered BEFORE express.json().
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), webhookHandler(store));

  app.use('/api', generalLimiter, express.json({ limit: '10kb' }), apiRouter({ store, stripe: deps.stripe ?? getStripe }));
  app.use('/api', notFound);

  const dist = path.join(ROOT_DIR, 'client/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
