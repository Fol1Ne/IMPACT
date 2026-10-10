import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { quakeToHazard } from '../src/services/hazards';
import { SmsStore, __setSmsStore, alertBody, cancelSms, checkSmsAlerts, isMajorDisaster, last4, subscribeSms } from '../src/services/sms';
import { createApp } from '../src/app';
import { EntitlementStore } from '../src/services/entitlements';
import type { QuakeEvent } from '../../shared/types';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;
const saved: Partial<Record<string, string>> = {};

const quake = (id: string, mag: number, lat = 45, lng = 10): QuakeEvent => ({
  id, title: `M ${mag} ${id}`, magnitude: mag, magType: 'mww', place: 'Testville', time: NOW, updated: null,
  longitude: lng, latitude: lat, depthKm: 10, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
  status: 'reviewed', significance: 1, alert: null, tsunami: null, felt: null, network: 'us',
});

const json = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('SMS major-disaster rules', () => {
  it('treats M6+ quakes and selected natural hazards as major, not smaller quakes', () => {
    expect(isMajorDisaster(quakeToHazard(quake('a', 5.9)))).toBe(false);
    expect(isMajorDisaster(quakeToHazard(quake('b', 6)))).toBe(true);
    expect(alertBody(quakeToHazard(quake('c', 7.1)))).toMatch(/IMPACT: major earthquakes/);
    expect(alertBody(quakeToHazard(quake('c', 7.1))).length).toBeLessThanOrEqual(320);
    expect(last4('+15551234567')).toBe('4567');
  });
});

describe('SMS subscribe and watch', () => {
  beforeEach(() => {
    for (const k of ENV) { saved[k] = process.env[k]; }
    process.env.TWILIO_ACCOUNT_SID = 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15550001111';
    __setSmsStore(new SmsStore(null));
  });
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    __setSmsStore(null);
  });

  const hazards = (async (url: string) => {
    if (url.includes('usgs.gov')) return json({ type: 'FeatureCollection', metadata: { count: 1 }, features: [{ id: 'usbig', properties: { mag: 7.2, time: NOW, title: 'M 7.2 Testville' }, geometry: { coordinates: [10.05, 45.02, 8] } }] }, 200);
    return json({ events: [] }, 200);
  }) as typeof fetch;

  it('sends confirmation and a nearby major-event alert, then ignores that event on the next poll', async () => {
    const sent: string[] = [];
    const smsFetch = (async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return json({ sid: 'SMxxx', status: 'queued' });
    }) as typeof fetch;
    const r = await subscribeSms({ phone: '+15551234567', latitude: 45, longitude: 10, radiusKm: 250 }, { fetchImpl: hazards, smsFetch, now: () => NOW });
    expect(r.subscribed).toBe(true);
    expect(r.last4).toBe('4567');
    expect(r.sent).toEqual({ confirmation: true, alert: true });
    expect(r.nearbyMajor[0]?.title).toMatch(/7\.2/);
    expect(sent).toHaveLength(2);
    expect(decodeURIComponent(sent[0]!.replace(/\+/g, ' '))).toMatch(/SMS alerts are on/);
    expect(JSON.stringify(sent)).not.toContain('token');
    const n = await checkSmsAlerts({ fetchImpl: hazards, smsFetch, now: () => NOW });
    expect(n).toBe(0);
  });

  it('cancels a subscription', async () => {
    const smsFetch = (async () => json({ sid: 'SMxxx' })) as typeof fetch;
    await subscribeSms({ phone: '+15551234567', latitude: 45, longitude: 10, radiusKm: 250 }, { fetchImpl: hazards, smsFetch, now: () => NOW });
    expect(cancelSms('+15551234567').cancelled).toBe(true);
    expect(cancelSms('+15551234567').cancelled).toBe(false);
  });

  it('rejects a non-E.164 number on the route', async () => {
    const app = createApp({ store: new EntitlementStore(null), stripe: () => null });
    const res = await request(app).post('/api/alerts/sms').send({ phone: '555-1234', latitude: 45, longitude: 10, radiusKm: 250 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_sms_request');
  });
});
