import type { RequestHandler } from 'express';
import Stripe from 'stripe';
import { getConfig } from '../config';
import { log } from '../logger';
import { stripeProblem, handleWebhookEvent } from '../services/stripe';
import type { EntitlementStore } from '../services/entitlements';

/** Mounted with express.raw() so the signature can be verified against the exact bytes Stripe sent. */
export const webhookHandler = (store: EntitlementStore): RequestHandler => (req, res) => {
  const cfg = getConfig();
  if (stripeProblem() || !cfg.stripe.webhookSecret) {
    res.status(503).json({ error: { code: 'webhook_not_configured', message: 'Stripe webhook is not configured.' } });
    return;
  }
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    res.status(400).json({ error: { code: 'missing_signature', message: 'Missing Stripe signature.' } });
    return;
  }
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(req.body as Buffer, signature, cfg.stripe.webhookSecret);
  } catch {
    log('warn', 'webhook_signature_invalid');
    res.status(400).json({ error: { code: 'invalid_signature', message: 'Signature verification failed.' } });
    return;
  }
  const result = handleWebhookEvent(event, store);
  log('info', 'webhook_received', { type: event.type, granted: result.granted });
  res.json({ received: true });
};
