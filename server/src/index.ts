import { createApp } from './app';
import { getConfig } from './config';
import { log } from './logger';
import { startSmsWatcher, twilioConfigured } from './services/sms';
import { stripeProblem } from './services/stripe';

const cfg = getConfig();
createApp().listen(cfg.port, () => {
  startSmsWatcher();
  log('info', 'impact_server_listening', {
    port: cfg.port,
    openrouterConfigured: Boolean(cfg.openrouter.apiKey),
    stripeConfigured: !stripeProblem(),
    webhookConfigured: Boolean(cfg.stripe.webhookSecret),
    twilioConfigured: twilioConfigured(),
  });
});
