import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterEvents, magnitudeBand, sortEvents, type QuakeEvent } from '../../shared/types';
import { __resetUsgsCache, getEvents, normalizeFeature, normalizeFeed } from '../src/services/usgs';

const feature = (over: Record<string, unknown> = {}, coords: unknown[] = [142.3, 37.6, 32]) => ({
  id: 'us7000abcd',
  properties: { mag: 6.8, magType: 'mww', place: 'Off the east coast of Honshu, Japan', time: 1744812120000, updated: 1744815720000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', status: 'reviewed', sig: 720, tsunami: 0, net: 'us', ...over },
  geometry: { type: 'Point', coordinates: coords },
});

describe('USGS normalisation', () => {
  it('maps source fields', () => {
    const e = normalizeFeature(feature())!;
    expect(e).toMatchObject({ id: 'us7000abcd', magnitude: 6.8, longitude: 142.3, latitude: 37.6, depthKm: 32, tsunami: false, alert: null, felt: null });
  });
  it('keeps missing values as null instead of inventing them', () => {
    const e = normalizeFeature(feature({ mag: null, place: null, url: null, title: null, time: null }, [10, 20]))!;
    expect(e.magnitude).toBeNull();
    expect(e.depthKm).toBeNull();
    expect(e.url).toBeNull();
    expect(e.time).toBeNull();
  });
  it('drops features without usable coordinates or id', () => {
    expect(normalizeFeature(feature({}, [999, 10, 1]))).toBeNull();
    expect(normalizeFeature({ properties: {}, geometry: { coordinates: [1, 2, 3] } })).toBeNull();
    expect(normalizeFeature(null)).toBeNull();
  });
  it('rejects non-https event URLs', () => {
    expect(normalizeFeature(feature({ url: 'javascript:alert(1)' }))!.url).toBeNull();
  });
  it('rejects an unexpected feed shape', () => {
    expect(() => normalizeFeed({ nope: true })).toThrow();
  });
});

describe('feed cache and staleness', () => {
  beforeEach(() => __resetUsgsCache());
  const ok = () => ({ ok: true, status: 200, json: async () => ({ metadata: { generated: 5 }, features: [feature()] }) }) as unknown as Response;
  it('serves fresh data, then labels cached data as stale when USGS fails', async () => {
    let t = 1000;
    const good = vi.fn(async () => ok());
    const first = await getEvents('4.5_week', { fetchImpl: good as unknown as typeof fetch, now: () => t });
    expect(first.meta.stale).toBe(false);
    t += 120_000;
    const bad = vi.fn(async () => { throw new Error('down'); });
    const second = await getEvents('4.5_week', { fetchImpl: bad as unknown as typeof fetch, now: () => t });
    expect(second.meta.stale).toBe(true);
    expect(second.meta.fetchedAt).toBe(1000);
    expect(second.events).toHaveLength(1);
  });
  it('throws an honest error when there is no cache', async () => {
    const bad = vi.fn(async () => { throw new Error('down'); });
    await expect(getEvents('all_day', { fetchImpl: bad as unknown as typeof fetch })).rejects.toMatchObject({ status: 502 });
  });
});

describe('filter, sort and bands', () => {
  const mk = (id: string, mag: number | null, place: string, time: number): QuakeEvent => ({ ...normalizeFeature(feature({ mag, place, time }))!, id });
  const list = [mk('a1a1', 4.6, 'Chile', 3), mk('b2b2', 6.9, 'Japan', 1), mk('c3c3', null, 'Peru', 2)];
  it('filters by magnitude and text', () => {
    expect(filterEvents(list, { minMagnitude: 5 }).map((e) => e.id)).toEqual(['b2b2']);
    expect(filterEvents(list, { query: 'peru' }).map((e) => e.id)).toEqual(['c3c3']);
    expect(filterEvents(list, { query: 'nowhere' })).toEqual([]);
  });
  it('sorts by time and magnitude with null magnitudes last', () => {
    expect(sortEvents(list, 'time').map((e) => e.id)).toEqual(['a1a1', 'c3c3', 'b2b2']);
    expect(sortEvents(list, 'magnitude').map((e) => e.id)).toEqual(['b2b2', 'a1a1', 'c3c3']);
  });
  it('bands depend only on magnitude', () => {
    expect([magnitudeBand(3), magnitudeBand(5), magnitudeBand(6), magnitudeBand(null)]).toEqual(['under-4.5', '4.5-5.9', '6-plus', 'unknown']);
  });
});
