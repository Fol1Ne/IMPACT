import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resolveRange, type HazardsResponse, type QuakeEvent } from '../../shared/types';
import { createApp } from '../src/app';
import { EntitlementStore } from '../src/services/entitlements';
import { __resetEonetCache, normalizeEonetEvent } from '../src/services/eonet';
import { quakeToHazard } from '../src/services/hazards';
import { __resetHistoryCache } from '../src/services/history';
import {
  MAX_FACTS, SafetyRequestSchema, buildLimitations, buildSafetyContext, buildSafetyFacts, buildSafetyMessages, parseSafetyOutput, planSafety,
} from '../src/services/safety';
import { __resetUsgsRangeCache } from '../src/services/usgs';
import { __resetConflictCountriesCache } from '../src/services/conflictCountries';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const range = resolveRange({ preset: '7d' }, NOW);
const quake = (id: string, lat: number, lng: number, mag = 5): QuakeEvent => ({
  id, title: `M ${mag} quake ${id}`, magnitude: mag, magType: 'mb', place: 'Somewhere', time: NOW - 3600_000, updated: null, longitude: lng, latitude: lat, depthKm: 10,
  url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, status: 'reviewed', significance: 1, alert: null, tsunami: null, felt: null, network: 'us',
});
const fire = normalizeEonetEvent({ id: 'EONET_5', title: 'Wildfire near A', link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_5', categories: [{ id: 'wildfires' }], sources: [{ id: 'IRWIN', url: 'https://irwin.example/1' }], geometry: [{ date: '2026-10-09T00:00:00Z', type: 'Point', coordinates: [10.5, 45] }] })!;

const data = (over: Partial<HazardsResponse['meta']> = {}): HazardsResponse => ({
  events: [quakeToHazard(quake('near', 45, 10.1)), quakeToHazard(quake('far', 10, 100)), fire],
  meta: { range, minMagnitude: 2.5, merged: 0, limitations: [], conflictSource: null, providers: [{ provider: 'usgs', ok: true, stale: false, partial: false, fetchedAt: NOW, count: 2, notes: [] }, { provider: 'eonet', ok: true, stale: false, partial: false, fetchedAt: NOW, count: 1, notes: [] }], ...over },
});
const req = { latitude: 45, longitude: 10, radiusKm: 250, window: '7d' as const, region: 'Italy' };

describe('safety context construction', () => {
  it('keeps only events inside the radius, nearest first, with references', () => {
    const { facts, total } = buildSafetyFacts(data(), 45, 10, 250);
    expect(total).toBe(2);
    expect(facts.map((f) => [f.ref, f.eventId])).toEqual([['E1', 'usgs:near'], ['E2', 'eonet:EONET_5']]);
    expect(facts[0]!.sources[0]!.url).toContain('earthquake.usgs.gov');
  });
  it('bounds the number of events sent', () => {
    const many: HazardsResponse = { ...data(), events: Array.from({ length: 40 }, (_, i) => quakeToHazard(quake(`q${i}`, 45, 10 + i * 0.01))) };
    const { facts, total } = buildSafetyFacts(many, 45, 10, 500);
    expect(facts).toHaveLength(MAX_FACTS);
    expect(buildLimitations(many, total, 500).join(' ')).toMatch(/only the 25 nearest/);
  });
  it('flags stale, partial and failed sources and never implies safety', () => {
    const d = data({ providers: [{ provider: 'usgs', ok: true, stale: true, partial: false, fetchedAt: NOW, count: 1, notes: [] }, { provider: 'eonet', ok: false, stale: false, partial: false, fetchedAt: null, count: 0, error: 'timeout', notes: [] }] });
    const l = buildLimitations(d, 1, 250).join(' ');
    expect(l).toMatch(/USGS data is stale/);
    expect(l).toMatch(/NASA EONET could not be reached \(timeout\)/);
    expect(l).toMatch(/does not mean an area is safe/);
  });
  it('sends a compact context with no personal data, and marks it untrusted', () => {
    const { facts } = buildSafetyFacts(data(), 45, 10, 250);
    const ctx = buildSafetyContext(req, data(), facts, []);
    expect(ctx.point).toEqual({ latitude: 45, longitude: 10, approximateRegion: 'Italy' });
    expect(ctx.events[1]!.sources).toEqual(['IRWIN', 'NASA EONET']);
    const [system, user] = buildSafetyMessages(ctx);
    expect(system!.content).toMatch(/NEVER invent disasters, evacuation orders, shelters, emergency phone numbers/);
    expect(user!.content).toMatch(/untrusted data/);
  });
  it('validates requests strictly', () => {
    expect(SafetyRequestSchema.safeParse(req).success).toBe(true);
    expect(SafetyRequestSchema.safeParse({ ...req, radiusKm: 333 }).success).toBe(false);
    expect(SafetyRequestSchema.safeParse({ ...req, latitude: 91 }).success).toBe(false);
    expect(SafetyRequestSchema.safeParse({ ...req, region: '<script>' }).success).toBe(false);
    expect(SafetyRequestSchema.safeParse({ ...req, apiKey: 'x' }).success).toBe(false);
  });
});

describe('AI output handling', () => {
  const { facts } = buildSafetyFacts(data(), 45, 10, 250);
  it('drops hazards and references that are not in the verified facts', () => {
    const out = parseSafetyOutput(JSON.stringify({
      summary: 'One earthquake and one wildfire nearby.',
      hazards: [
        { category: 'Earthquakes', eventRefs: ['E1', 'E2', 'E9'], advice: ['Drop, cover and hold on during shaking.'] },
        { category: 'Floods', eventRefs: [], advice: ['Move to higher ground.'] },
        { category: 'wildfires', eventRefs: ['E2'], advice: ['Follow local fire service instructions.'] },
      ],
      general: ['Follow local authorities.'], uncertainties: ['Data may be incomplete.'],
    }), facts, 'test-model');
    expect(out.hazards.map((h) => [h.category, h.eventRefs])).toEqual([['earthquakes', ['E1']], ['wildfires', ['E2']]]);
  });
  it('rejects malformed output', () => {
    expect(() => parseSafetyOutput('nope', facts, 'm')).toThrow(/unusable/);
  });
});

describe('planSafety fallbacks', () => {
  beforeEach(() => { __resetEonetCache(); __resetUsgsRangeCache(); __resetHistoryCache(); __resetConflictCountriesCache(); process.env.OPENROUTER_API_KEY = 'k'; });
  afterEach(() => { delete process.env.OPENROUTER_API_KEY; });
  const usgsBody = { features: [{ id: 'us1', properties: { mag: 5, time: NOW - 1000, title: 'M 5' }, geometry: { coordinates: [10.1, 45, 3] } }] };
  const sources = (async (url: string) => (url.includes('usgs.gov')
    ? { ok: true, status: 200, json: async () => usgsBody }
    : { ok: true, status: 200, json: async () => ({ events: [] }) })) as unknown as typeof fetch;

  it('shows facts and links without advice when the AI times out', async () => {
    const timeout = (async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }) as unknown as typeof fetch;
    const r = await planSafety(req, { fetchImpl: sources, aiFetchImpl: timeout, now: () => NOW });
    expect(r.guidance).toMatchObject({ status: 'unavailable', code: 'ai_timeout' });
    expect(r.facts).toHaveLength(1);
    expect(r.officialLinks.some((l) => l.url.includes('usgs.gov'))).toBe(true);
    expect(r.disclaimer).toMatch(/not an official emergency-warning system/);
  });
  it('falls back the same way when AI is not configured', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const r = await planSafety(req, { fetchImpl: sources, now: () => NOW });
    expect(r.guidance).toMatchObject({ status: 'unavailable', code: 'ai_not_configured' });
  });
  it('does not call the AI when nothing is nearby, and says that is not safety', async () => {
    let called = false;
    const ai = (async () => { called = true; throw new Error('should not run'); }) as unknown as typeof fetch;
    const r = await planSafety({ ...req, latitude: -45, longitude: -120 }, { fetchImpl: sources, aiFetchImpl: ai, now: () => NOW });
    expect(called).toBe(false);
    expect(r.guidance.status).toBe('not_generated');
    expect(r.guidance.status === 'not_generated' && r.guidance.reason).toMatch(/does not mean the area is safe/);
  });
  it('still answers with links when every event source is down', async () => {
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await planSafety(req, { fetchImpl: down, now: () => NOW });
    expect(r.guidance).toMatchObject({ status: 'unavailable', code: 'sources_unavailable' });
    expect(r.officialLinks.length).toBeGreaterThan(0);
  });
  it('returns validated advice on success', async () => {
    const ai = (async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'A M5 quake 8 km away.', hazards: [{ category: 'Earthquakes', eventRefs: ['E1'], advice: ['Expect aftershocks.'] }], general: [], uncertainties: [] }) } }] }) })) as unknown as typeof fetch;
    const r = await planSafety(req, { fetchImpl: sources, aiFetchImpl: ai, now: () => NOW });
    expect(r.guidance).toMatchObject({ status: 'ok', hazards: [{ category: 'earthquakes', eventRefs: ['E1'] }] });
  });
});

describe('POST /api/safety', () => {
  it('rejects invalid input', async () => {
    const app = createApp({ store: new EntitlementStore(null), stripe: () => null });
    expect((await request(app).post('/api/safety').send({ latitude: 'x' })).body.error.code).toBe('invalid_safety_request');
  });
});
