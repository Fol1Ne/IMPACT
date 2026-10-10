import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { haversineKm, resolveRange, type HazardCategory, type HazardEvent, type SmsAlertResult } from '../../../shared/types';
import { getConfig } from '../config';
import { HttpError } from '../errors';
import { log } from '../logger';
import { getHazards } from './hazards';

export const E164 = /^\+[1-9]\d{7,14}$/;
export const SmsSubscribeSchema = z.object({
  phone: z.string().trim().regex(E164, 'Use an international number starting with + and country code, digits only after that.'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z.number().refine((r) => r === 100 || r === 250 || r === 500 || r === 1000, 'Unsupported radius'),
}).strict();
export const SmsCancelSchema = z.object({ phone: z.string().trim().regex(E164) }).strict();

export const MAJOR_QUAKE = 6;
const MAX_SUBS = 80;
const POLL_MS = 5 * 60_000;
const SMS_MAX = 320;

export interface SmsSub {
  phone: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  createdAt: number;
  seen: string[];
}

export function twilioConfigured(): boolean {
  const t = getConfig().twilio;
  return Boolean(t.accountSid.startsWith('AC') && t.authToken && /^\+[1-9]\d{7,14}$/.test(t.fromNumber));
}

export function last4(phone: string): string {
  return phone.slice(-4);
}

export function isMajorDisaster(e: HazardEvent): boolean {
  if (e.category === 'earthquakes') return (e.severity?.value ?? 0) >= MAJOR_QUAKE;
  return e.category === 'volcanoes' || e.category === 'severeStorms' || e.category === 'floods' || e.category === 'wildfires';
}

export function majorNear(events: HazardEvent[], lat: number, lng: number, radiusKm: number): HazardEvent[] {
  return events
    .filter((e) => isMajorDisaster(e) && haversineKm(lat, lng, e.latitude, e.longitude) <= radiusKm)
    .sort((a, b) => (b.severity?.value ?? 0) - (a.severity?.value ?? 0) || (b.startTime ?? 0) - (a.startTime ?? 0));
}

export function alertBody(e: HazardEvent): string {
  const place = e.place ? ` near ${e.place}` : '';
  const sev = e.severity ? ` ${e.severity.unit === 'M' || e.severity.unit.startsWith('M ') ? `M${e.severity.value}` : ''}`.trim() : '';
  const text = `IMPACT: major ${e.category} reported${sev ? ` (${sev})` : ''}${place}. ${e.title}. Not an official warning. Follow local authorities.`;
  return text.slice(0, SMS_MAX);
}

export function confirmBody(radiusKm: number): string {
  return `IMPACT: SMS alerts are on for major disasters within ${radiusKm} km of your pin (earthquakes M${MAJOR_QUAKE}+, storms, floods, wildfires, volcanoes). Not an official warning system. Your number is not shared.`;
}

type FetchLike = typeof fetch;

export async function sendSms(to: string, body: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const { accountSid, authToken, fromNumber } = getConfig().twilio;
  if (!twilioConfigured()) throw new HttpError(503, 'sms_not_configured', 'SMS alerts are not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER on the server.');
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    log('warn', 'twilio_send_failed', { status: res.status, reason: err.slice(0, 180) });
    throw new HttpError(502, 'sms_send_failed', 'Twilio could not send the message. Check the From number and that the destination can receive SMS.');
  }
}

export class SmsStore {
  private byPhone = new Map<string, SmsSub>();
  constructor(private filePath: string | null) {
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { subscriptions?: SmsSub[] };
          for (const s of data.subscriptions ?? []) if (E164.test(s.phone)) this.byPhone.set(s.phone, s);
        }
      } catch { log('warn', 'sms_alerts_file_unreadable'); }
    }
  }
  get(phone: string) { return this.byPhone.get(phone); }
  all() { return [...this.byPhone.values()]; }
  upsert(s: SmsSub) {
    this.byPhone.set(s.phone, s);
    while (this.byPhone.size > MAX_SUBS) this.byPhone.delete(this.byPhone.keys().next().value!);
    this.persist();
  }
  remove(phone: string) { const ok = this.byPhone.delete(phone); this.persist(); return ok; }
  private persist() {
    if (!this.filePath) return;
      try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ subscriptions: this.all() }, null, 2));
    } catch (err) {
      log('error', 'sms_alerts_write_failed', { reason: (err as Error).message });
    }
  }
}

let store: SmsStore | null = null;
export const getSmsStore = () => (store ??= new SmsStore(getConfig().smsAlertsFile));
export const __setSmsStore = (s: SmsStore | null) => { store = s; };

export async function subscribeSms(input: z.infer<typeof SmsSubscribeSchema>, opts: { fetchImpl?: FetchLike; now?: () => number; smsFetch?: FetchLike } = {}): Promise<SmsAlertResult> {
  if (!twilioConfigured()) throw new HttpError(503, 'sms_not_configured', 'SMS alerts are not configured on this server. Twilio test credentials are required.');
  const now = opts.now ?? Date.now;
  const lat = Math.round(input.latitude * 1000) / 1000;
  const lng = Math.round(input.longitude * 1000) / 1000;
  const data = await getHazards({ range: resolveRange({ preset: '24h' }, now()), minMagnitude: 0, providers: ['usgs', 'eonet'], fetchImpl: opts.fetchImpl, now });
  const nearby = majorNear(data.events, lat, lng, input.radiusKm);
  const sub: SmsSub = { phone: input.phone, latitude: lat, longitude: lng, radiusKm: input.radiusKm, createdAt: now(), seen: nearby.map((e) => e.id) };
  getSmsStore().upsert(sub);
  const send = opts.smsFetch ?? fetch;
  await sendSms(input.phone, confirmBody(input.radiusKm), send);
  let alert = false;
  if (nearby[0]) {
    await sendSms(input.phone, alertBody(nearby[0]), send);
    alert = true;
  }
  return {
    configured: true, subscribed: true, last4: last4(input.phone), radiusKm: input.radiusKm,
    nearbyMajor: nearby.slice(0, 5).map((e) => ({ title: e.title, category: e.category as HazardCategory, place: e.place })),
    sent: { confirmation: true, alert },
  };
}

export function cancelSms(phone: string): { cancelled: boolean } {
  return { cancelled: getSmsStore().remove(phone) };
}

export async function checkSmsAlerts(opts: { fetchImpl?: FetchLike; now?: () => number; smsFetch?: FetchLike } = {}): Promise<number> {
  const subs = getSmsStore().all();
  if (subs.length === 0 || !twilioConfigured()) return 0;
  const now = opts.now ?? Date.now;
  const data = await getHazards({ range: resolveRange({ preset: '24h' }, now()), minMagnitude: 0, providers: ['usgs', 'eonet'], fetchImpl: opts.fetchImpl, now });
  let sent = 0;
  for (const sub of subs) {
    const seen = new Set(sub.seen);
    const fresh = majorNear(data.events, sub.latitude, sub.longitude, sub.radiusKm).filter((e) => !seen.has(e.id));
    const nextSeen = [...sub.seen, ...fresh.map((e) => e.id)].slice(-400);
    if (fresh[0]) {
      try {
        await sendSms(sub.phone, alertBody(fresh[0]), opts.smsFetch ?? fetch);
        sent++;
      } catch { /* already logged */ }
    }
    getSmsStore().upsert({ ...sub, seen: nextSeen });
  }
  return sent;
}

export function startSmsWatcher() {
  if (!twilioConfigured()) return;
  const tick = () => { void checkSmsAlerts().catch((err: Error) => log('warn', 'sms_watch_failed', { reason: err.message })); };
  setInterval(tick, POLL_MS);
}
