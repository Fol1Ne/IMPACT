import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { filterHazards, minMagnitudeFloor, resolveRange, sortHazards, type HazardEvent, type QuakeEvent } from '../../shared/types';
import { createApp } from '../src/app';
import { EntitlementStore } from '../src/services/entitlements';
import { __resetEonetCache, eonetWindows, normalizeEonetEvent, normalizeEonetResponse, queryEonetRange } from '../src/services/eonet';
import { getHazards, quakeToHazard } from '../src/services/hazards';
import { mergeCrossSource } from '../src/services/matching';
import { __resetUsgsRangeCache, buildRangeUrl, queryUsgsRange } from '../src/services/usgs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-10T12:00:00Z');

const eonetRaw = (over: Record<string, unknown> = {}) => ({
  id: 'EONET_1', title: 'Wildfire in Mongolia 1032652', description: null, link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1', closed: null,
  categories: [{ id: 'wildfires', title: 'Wildfires' }],
  sources: [{ id: 'GDACS', url: 'https://www.gdacs.org/report.aspx?eventtype=WF&eventid=1032652' }],
  geometry: [{ magnitudeValue: 17663, magnitudeUnit: 'hectare', date: '2026-10-07T19:00:00Z', type: 'Point', coordinates: [119.22, 46.99] }],
  ...over,
});

const quake = (over: Partial<QuakeEvent> = {}): QuakeEvent => ({
  id: 'us7000abcd', title: 'M 6.1 - Off Honshu', magnitude: 6.1, magType: 'mww', place: 'Off Honshu', time: Date.parse('2026-10-09T10:00:00Z'), updated: null,
  longitude: 142.3, latitude: 37.6, depthKm: 30, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', status: 'reviewed', significance: 600,
  alert: null, tsunami: false, felt: null, network: 'us', ...over,
});

const eonetQuake = (over: Record<string, unknown> = {}, geom: Record<string, unknown> = {}) => normalizeEonetEvent(eonetRaw({
  id: 'EONET_9', title: 'M 6.1 Japan', categories: [{ id: 'earthquakes', title: 'Earthquakes' }],
  sources: [{ id: 'EO', url: 'https://earthobservatory.nasa.gov/images/1' }],
  geometry: [{ magnitudeValue: 6.0, magnitudeUnit: 'Mw', date: '2026-10-09T10:01:00Z', type: 'Point', coordinates: [142.4, 37.65], ...geom }],
  ...over,
}))!;

describe('NASA EONET normalisation', () => {
  it('maps a GDACS-cited wildfire to the Wildfires category with its source link', () => {
    const e = normalizeEonetEvent(eonetRaw())!;
    expect(e).toMatchObject({ id: 'eonet:EONET_1', category: 'wildfires', latitude: 46.99, longitude: 119.22, geometryType: 'point', severity: { value: 17663, unit: 'hectare', provider: 'eonet' } });
    expect(e.sources.map((s) => s.origin ?? s.label)).toEqual(['GDACS', 'NASA EONET event record (JSON)']);
    expect(e.sources[0]!.url).toContain('gdacs.org');
  });
  it('uses the latest point of a track and keeps earlier positions', () => {
    const e = normalizeEonetEvent(eonetRaw({ categories: [{ id: 'severeStorms' }], geometry: [
      { date: '2026-10-07T18:00:00Z', type: 'Point', coordinates: [-101, 15], magnitudeValue: 35, magnitudeUnit: 'kts' },
      { date: '2026-10-06T18:00:00Z', type: 'Point', coordinates: [-100, 14], magnitudeValue: 30, magnitudeUnit: 'kts' },
    ] }))!;
    expect(e).toMatchObject({ category: 'severeStorms', longitude: -101, latitude: 15, geometryType: 'track', severity: { value: 35 } });
    expect(e.track).toEqual([[-100, 14], [-101, 15]]);
    expect(e.startTime).toBe(Date.parse('2026-10-06T18:00:00Z'));
  });
  it('reduces polygons to the centre of their outer ring', () => {
    const e = normalizeEonetEvent(eonetRaw({ categories: [{ id: 'floods' }], geometry: [{ date: '2026-10-01T00:00:00Z', type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }] }))!;
    expect(e).toMatchObject({ geometryType: 'polygon', longitude: 1, latitude: 1, severity: null });
  });
  it('drops events with missing or invalid geometry, unknown categories, or bad shape', () => {
    expect(normalizeEonetEvent(eonetRaw({ geometry: [] }))).toBeNull();
    expect(normalizeEonetEvent(eonetRaw({ geometry: [{ type: 'Point', coordinates: [999, 0] }] }))).toBeNull();
    expect(normalizeEonetEvent(eonetRaw({ geometry: [{ type: 'LineString', coordinates: [[0, 0], [1, 1]] }] }))).toBeNull();
    expect(normalizeEonetEvent(eonetRaw({ categories: [{ id: 'aliens' }] }))).toBeNull();
    expect(normalizeEonetEvent(null)).toBeNull();
    expect(() => normalizeEonetResponse({ nope: 1 })).toThrow();
  });
  it('rejects non-http source links', () => {
    const e = normalizeEonetEvent(eonetRaw({ sources: [{ id: 'X', url: 'javascript:alert(1)' }] }))!;
    expect(e.sources.every((s) => !s.url?.startsWith('javascript'))).toBe(true);
  });
});

describe('date windows and ranges', () => {
  it('splits a year into 30-day UTC windows, newest first, with no gaps', () => {
    const w = eonetWindows(NOW - 365 * DAY, NOW);
    expect(w[0]!.end).toBe('2026-10-10');
    expect(w.length).toBe(13);
    for (let i = 1; i < w.length; i++) expect(Date.parse(w[i - 1]!.start) - Date.parse(w[i]!.end)).toBe(DAY);
  });
  it('resolves presets as rolling ranges and validates custom dates', () => {
    expect(resolveRange({ preset: '365d' }, NOW)).toMatchObject({ start: NOW - 365 * DAY, end: NOW, preset: '365d' });
    expect(resolveRange({ start: '2026-01-01', end: '2026-01-31' }, NOW)).toMatchObject({ start: Date.parse('2026-01-01T00:00:00Z'), end: Date.parse('2026-01-31T23:59:59.999Z'), preset: 'custom' });
    expect(() => resolveRange({ start: '2026-02-01', end: '2026-01-01' }, NOW)).toThrow();
    expect(() => resolveRange({ start: '2024-01-01', end: '2026-01-01' }, NOW)).toThrow(/366/);
    expect(() => resolveRange({ start: '2026-01-01' }, NOW)).toThrow();
    expect(() => resolveRange({ preset: 'forever' }, NOW)).toThrow();
  });
  it('raises the magnitude floor for long ranges', () => {
    expect(minMagnitudeFloor(resolveRange({ preset: '30d' }, NOW))).toBe(2.5);
    expect(minMagnitudeFloor(resolveRange({ preset: '90d' }, NOW))).toBe(4.5);
  });
  it('combines category, source, magnitude and text filters', () => {
    const fire = normalizeEonetEvent(eonetRaw())!;
    const small = quakeToHazard(quake({ id: 'a', magnitude: 3 }));
    const big = quakeToHazard(quake({ id: 'b', magnitude: 6.5, place: 'Chile' }));
    const all = [fire, small, big];
    expect(filterHazards(all, { categories: ['earthquakes'], minMagnitude: 5 }).map((e) => e.id)).toEqual(['usgs:b']);
    expect(filterHazards(all, { providers: ['eonet'] }).map((e) => e.id)).toEqual(['eonet:EONET_1']);
    expect(filterHazards(all, { minMagnitude: 5 }).map((e) => e.id)).toEqual(['eonet:EONET_1', 'usgs:b']); // magnitude only applies to quakes
    expect(filterHazards(all, { query: 'chile' }).map((e) => e.id)).toEqual(['usgs:b']);
    expect(sortHazards(all, 'severity')[0]!.id).toBe('usgs:b');
  });
});

describe('USGS range queries', () => {
  beforeEach(() => __resetUsgsRangeCache());
  it('builds a documented FDSN query', () => {
    const u = new URL(buildRangeUrl(NOW - DAY, NOW, 4.5));
    expect(u.pathname).toBe('/fdsnws/event/1/query');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ format: 'geojson', minmagnitude: '4.5', orderby: 'time', limit: '20000' });
  });
  it('caches, then serves stale data when USGS fails, and explains a rejected query', async () => {
    let t = NOW;
    const body = { features: [{ id: 'us1', properties: { mag: 5, time: NOW - 1000 }, geometry: { coordinates: [1, 2, 3] } }] };
    const ok = (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
    const down = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect((await queryUsgsRange(NOW - DAY, NOW, 4.5, { fetchImpl: ok, now: () => t })).events).toHaveLength(1);
    t += 60_000;
    expect((await queryUsgsRange(NOW - DAY, NOW, 4.5, { fetchImpl: down, now: () => t })).stale).toBe(false); // still fresh, no fetch
    t += 2 * 60 * 60_000; // past ranges stay fresh for an hour
    expect((await queryUsgsRange(NOW - DAY, NOW, 4.5, { fetchImpl: down, now: () => t })).stale).toBe(true);
    const tooMany = (async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(queryUsgsRange(NOW - 300 * DAY, NOW, 2.5, { fetchImpl: tooMany })).rejects.toMatchObject({ code: 'usgs_query_rejected' });
  });
});

describe('cross-source matching', () => {
  const usgs = [quakeToHazard(quake())];

  it('merges on a cited USGS id and keeps both source links', () => {
    const cited = eonetQuake({ sources: [{ id: 'USGS_EHP', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd' }] }, { date: '2026-10-09T13:00:00Z', coordinates: [150, 40] });
    const { events, merged } = mergeCrossSource(usgs, [cited]);
    expect(merged).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.match?.method).toBe('identifier');
    expect(events[0]!.sources.map((s) => s.provider)).toEqual(['usgs', 'eonet', 'eonet']);
    expect(events[0]!.sources.some((s) => s.url?.includes('earthquake.usgs.gov'))).toBe(true);
    expect(events[0]!.severity?.provider).toBe('usgs'); // USGS facts stay authoritative
  });
  it('merges on close time, distance and magnitude when exactly one candidate qualifies', () => {
    const { events, merged } = mergeCrossSource(usgs, [eonetQuake()]);
    expect(merged).toBe(1);
    expect(events[0]!.match?.method).toBe('proximity');
  });
  it('keeps records separate when any proximity condition fails', () => {
    expect(mergeCrossSource(usgs, [eonetQuake({}, { date: '2026-10-09T10:30:00Z' })]).merged).toBe(0); // 30 min apart
    expect(mergeCrossSource(usgs, [eonetQuake({}, { coordinates: [143.5, 37.6] })]).merged).toBe(0); // ~100 km
    expect(mergeCrossSource(usgs, [eonetQuake({}, { magnitudeValue: 5.2 })]).merged).toBe(0); // magnitude differs
    expect(mergeCrossSource(usgs, [eonetQuake({}, { magnitudeValue: undefined, magnitudeUnit: undefined })]).merged).toBe(0); // no magnitude
  });
  it('does not merge when two USGS records are equally plausible', () => {
    const twins = [quakeToHazard(quake()), quakeToHazard(quake({ id: 'us7000abce', longitude: 142.35 }))];
    const { events, merged } = mergeCrossSource(twins, [eonetQuake()]);
    expect(merged).toBe(0);
    expect(events).toHaveLength(3);
  });
  it('never merges non-earthquake events and is deterministic', () => {
    const fire = normalizeEonetEvent(eonetRaw({ geometry: [{ date: '2026-10-09T10:00:00Z', type: 'Point', coordinates: [142.3, 37.6] }] }))!;
    const a = mergeCrossSource(usgs, [fire, eonetQuake()]);
    const b = mergeCrossSource(usgs, [eonetQuake(), fire]);
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
    expect(a.events.find((e) => e.category === 'wildfires')!.match).toBeNull();
  });
});

describe('hazard query layer', () => {
  beforeEach(() => { __resetEonetCache(); __resetUsgsRangeCache(); });
  const usgsBody = { features: [{ id: 'us1', properties: { mag: 5, time: NOW - 1000, title: 'M 5' }, geometry: { coordinates: [1, 2, 3] } }] };
  const eonetBody = { events: [eonetRaw()] };
  const routed = (fail: 'usgs' | 'eonet' | null) => (async (url: string) => {
    if (url.includes('earthquake.usgs.gov')) { if (fail === 'usgs') throw new Error('usgs down'); return { ok: true, status: 200, json: async () => usgsBody }; }
    if (fail === 'eonet') throw new Error('eonet down');
    return { ok: true, status: 200, json: async () => eonetBody };
  }) as unknown as typeof fetch;
  const range = resolveRange({ preset: '7d' }, NOW);

  it('combines both providers and reports each one', async () => {
    const r = await getHazards({ range, minMagnitude: 0, providers: ['usgs', 'eonet'], fetchImpl: routed(null), now: () => NOW });
    expect(r.events.map((e) => e.category).sort()).toEqual(['earthquakes', 'wildfires']);
    expect(r.meta.providers.map((p) => [p.provider, p.ok])).toEqual([['usgs', true], ['eonet', true]]);
    expect(r.meta.minMagnitude).toBe(2.5);
  });
  it('keeps working when one provider fails', async () => {
    const r = await getHazards({ range, minMagnitude: 0, providers: ['usgs', 'eonet'], fetchImpl: routed('eonet'), now: () => NOW });
    expect(r.events).toHaveLength(1);
    expect(r.meta.providers.find((p) => p.provider === 'eonet')).toMatchObject({ ok: false, error: expect.stringContaining('EONET') });
  });
  it('fails only when every provider fails', async () => {
    const both = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(getHazards({ range, minMagnitude: 0, providers: ['usgs', 'eonet'], fetchImpl: both, now: () => NOW })).rejects.toMatchObject({ status: 502 });
  });
  it('skips USGS when earthquakes are filtered out', async () => {
    const r = await getHazards({ range, minMagnitude: 0, providers: ['usgs', 'eonet'], categories: ['wildfires'], fetchImpl: routed('usgs'), now: () => NOW });
    expect(r.meta.providers.map((p) => p.provider)).toEqual(['eonet']);
  });
  it('reports partial data when some windows fail', async () => {
    let n = 0;
    const flaky = (async () => { n++; if (n === 2) throw new Error('timeout'); return { ok: true, status: 200, json: async () => eonetBody }; }) as unknown as typeof fetch;
    const r = await queryEonetRange(NOW - 90 * DAY, NOW, { fetchImpl: flaky, now: () => NOW });
    expect(r.failedWindows).toBe(1);
    expect(r.events).toHaveLength(1); // the same event across windows is kept once
  });
});

describe('GET /api/hazards validation', () => {
  const app = createApp({ store: new EntitlementStore(null), stripe: () => null });
  it('rejects bad ranges and filters', async () => {
    expect((await request(app).get('/api/hazards?range=forever')).body.error.code).toBe('invalid_range');
    expect((await request(app).get('/api/hazards?start=2026-02-01&end=2026-01-01')).body.error.code).toBe('invalid_range');
    expect((await request(app).get('/api/hazards?categories=wildfires,aliens')).body.error.code).toBe('invalid_filter');
    expect((await request(app).get('/api/hazards?sources=nope')).body.error.code).toBe('invalid_filter');
    expect((await request(app).get('/api/hazards?minMagnitude=99')).status).toBe(400);
  });
});

export type { HazardEvent };
