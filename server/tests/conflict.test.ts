import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRange } from '../../shared/types';
import { __resetConflictCache, activeConflictProvider, normalizeAcledRow, normalizeUcdpRow, queryConflictRange, ucdpMonthlyVersions } from '../src/services/conflict';
import { __resetConflictCountriesCache } from '../src/services/conflictCountries';
import { __resetEonetCache } from '../src/services/eonet';
import { getHazards } from '../src/services/hazards';
import { planSafety } from '../src/services/safety';
import { __resetUsgsRangeCache } from '../src/services/usgs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const now = () => NOW;
const range = resolveRange({ preset: '7d' }, NOW);
const ENV_KEYS = ['ACLED_EMAIL', 'ACLED_PASSWORD', 'UCDP_ACCESS_TOKEN', 'OPENROUTER_API_KEY'] as const;

const acledRow = (over: Record<string, unknown> = {}) => ({
  event_id_cnty: 'UKR1001', event_date: '2026-10-08', event_type: 'Battles', sub_event_type: 'Armed clash',
  actor1: 'Military Forces of A', actor2: 'Military Forces of B', country: 'Ukraine', admin1: 'Donetsk', location: 'Town X',
  latitude: '48.10', longitude: '37.70', geo_precision: '1', source: 'Local media', notes: 'On 8 October 2026, clashes were reported.', fatalities: '3', timestamp: '1791500000',
  ...over,
});
const ucdpRow = (over: Record<string, unknown> = {}) => ({
  id: 555, type_of_violence: 1, conflict_name: 'Country Y: Government', dyad_name: 'Government of Y - Group Z', side_a: 'Government of Y', side_b: 'Group Z',
  where_prec: 2, where_description: 'Village Q', adm_1: 'Province P', latitude: 12.5, longitude: 14.2, country: 'Country Y',
  date_start: '2026-08-03T00:00:00', date_end: '2026-08-04T00:00:00', best: 7, high: 9, low: 5,
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('conflict normalisation', () => {
  it('maps an ACLED battle row without inventing fields', () => {
    const e = normalizeAcledRow(acledRow())!;
    expect(e).toMatchObject({ id: 'acled:UKR1001', category: 'conflict', latitude: 48.1, longitude: 37.7, title: 'Armed clash: Town X, Ukraine', place: 'Town X, Donetsk, Ukraine' });
    expect(e.startTime).toBe(Date.parse('2026-10-08T00:00:00Z'));
    expect(e.severity).toEqual({ value: 3, unit: 'reported fatalities', provider: 'acled' });
    expect(e.conflict).toMatchObject({ eventType: 'Battles', battle: true, actors: ['Military Forces of A', 'Military Forces of B'], admin1: 'Donetsk' });
    expect(e.conflict!.locationPrecision).toMatch(/precision 1/);
    expect(e.sources[0]).toMatchObject({ provider: 'acled', url: null, origin: 'Local media' });
  });
  it('drops protests, riots, bad coordinates and malformed dates', () => {
    expect(normalizeAcledRow(acledRow({ event_type: 'Protests' }))).toBeNull();
    expect(normalizeAcledRow(acledRow({ event_type: 'Riots' }))).toBeNull();
    expect(normalizeAcledRow(acledRow({ latitude: '123' }))).toBeNull();
    expect(normalizeAcledRow(acledRow({ event_date: 'yesterday' }))).toBeNull();
    expect(normalizeAcledRow(acledRow({ event_type: 'Violence against civilians', fatalities: '' }))!.severity).toBeNull();
  });
  it('maps a UCDP Candidate row', () => {
    const e = normalizeUcdpRow(ucdpRow())!;
    expect(e).toMatchObject({ id: 'ucdp:555', category: 'conflict', title: 'State-based armed conflict: Village Q, Country Y' });
    expect(e.severity).toEqual({ value: 7, unit: 'estimated deaths (UCDP best)', provider: 'ucdp' });
    expect(e.conflict).toMatchObject({ battle: true, actors: ['Government of Y', 'Group Z'], subEventType: 'Country Y: Government' });
    expect(normalizeUcdpRow(ucdpRow({ type_of_violence: 3 }))!.conflict!.battle).toBe(false);
    expect(normalizeUcdpRow(ucdpRow({ type_of_violence: 9 }))).toBeNull();
  });
  it('lists monthly Candidate versions newest first', () => {
    expect(ucdpMonthlyVersions(Date.parse('2026-07-20T00:00:00Z'), Date.parse('2026-09-05T00:00:00Z')).map((v) => [v.version, v.start, v.end])).toEqual([
      ['26.0.9', '2026-09-01', '2026-09-05'], ['26.0.8', '2026-08-01', '2026-08-31'], ['26.0.7', '2026-07-20', '2026-07-31'],
    ]);
  });
});

describe('conflict providers', () => {
  const saved: Partial<Record<string, string>> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    __resetConflictCache(); __resetConflictCountriesCache(); __resetEonetCache(); __resetUsgsRangeCache();
  });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('is off without credentials and says so', async () => {
    expect(activeConflictProvider()).toBeNull();
    expect(await queryConflictRange(range.start, range.end, { now })).toBeNull();
  });

  it('logs in to ACLED once, filters by date and follows cursors', async () => {
    process.env.ACLED_EMAIL = 'me@example.org';
    process.env.ACLED_PASSWORD = 'secret';
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth/token')) return json({ access_token: 'tok', expires_in: 86400, refresh_token: 'r' });
      const u = new URL(url);
      const cursor = u.searchParams.get('cursor');
      const recentWindow = u.searchParams.get('event_date')!.endsWith('2026-10-10');
      if (!recentWindow) return json({ status: 200, success: true, data: [], next_cursor: null });
      if (cursor === '0') return json({ status: 200, success: true, data: [acledRow(), acledRow({ event_id_cnty: 'X', event_type: 'Protests' })], next_cursor: 'abc' });
      return json({ status: 200, success: true, data: [acledRow({ event_id_cnty: 'UKR1002', event_type: 'Explosions/Remote violence', sub_event_type: 'Shelling/artillery/missile attack' })], next_cursor: null });
    }) as typeof fetch;

    const r = (await queryConflictRange(range.start, range.end, { now, fetchImpl }))!;
    expect(r.provider).toBe('acled');
    expect(r.events.map((e) => e.id).sort()).toEqual(['acled:UKR1001', 'acled:UKR1002']);
    const tokenCalls = calls.filter((c) => c.url.endsWith('/oauth/token'));
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(String(tokenCalls[0]!.init!.body));
    expect(Object.fromEntries(form)).toEqual({ username: 'me@example.org', password: 'secret', grant_type: 'password', client_id: 'acled', scope: 'authenticated' });
    const reads = calls.filter((c) => c.url.includes('/api/acled/read'));
    expect(reads[0]!.url).toContain('event_date=2026-10-04|2026-10-10&event_date_where=BETWEEN');
    expect(reads[0]!.url).toContain('event_type=Battles:OR:event_type=Explosions%2FRemote%20violence:OR:event_type=Violence%20against%20civilians');
    expect((reads[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(reads.some((c) => c.url.includes('cursor=abc'))).toBe(true);
    // Credentials never leave the token request.
    expect(reads.every((c) => !c.url.includes('secret'))).toBe(true);
  });

  it('does not mix date-windowed conflict events into the hazard feed', async () => {
    process.env.ACLED_EMAIL = 'me@example.org';
    process.env.ACLED_PASSWORD = 'secret';
    const fetchImpl = (async (url: string) => {
      if (url.includes('eonet')) return json({ events: [] });
      return json({ type: 'FeatureCollection', metadata: { count: 0 }, features: [] });
    }) as typeof fetch;
    const res = await getHazards({ range, minMagnitude: 2.5, providers: ['usgs', 'eonet', 'acled'], fetchImpl, now });
    expect(res.meta.conflictSource).toBeNull();
    expect(res.events.every((e) => e.category !== 'conflict')).toBe(true);
  });

  it('uses UCDP Candidate with its token header when ACLED is not configured', async () => {
    process.env.UCDP_ACCESS_TOKEN = 'ucdp-token';
    const seen: { url: string; token: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, token: (init!.headers as Record<string, string>)['x-ucdp-access-token']! });
      if (url.includes('/26.0.10')) return json({ message: 'not found' }, 404);
      if (url.includes('page=2')) return json({ TotalCount: 2, TotalPages: 2, NextPageUrl: '', Result: [ucdpRow({ id: 556, date_start: '2026-10-05T00:00:00', date_end: '2026-10-05T00:00:00' })] });
      return json({ TotalCount: 2, TotalPages: 2, NextPageUrl: 'https://ucdpapi.pcr.uu.se/api/gedevents/26.0.9?pagesize=1000&page=2', Result: [ucdpRow({ date_start: '2026-10-04T00:00:00', date_end: '2026-10-04T00:00:00' })] });
    }) as typeof fetch;
    const r = (await queryConflictRange(Date.parse('2026-09-28T00:00:00Z'), NOW, { now, fetchImpl }))!;
    expect(r.provider).toBe('ucdp');
    expect(seen.every((s) => s.token === 'ucdp-token')).toBe(true);
    expect(seen[0]!.url).toBe('https://ucdpapi.pcr.uu.se/api/gedevents/26.0.10?pagesize=1000&StartDate=2026-10-01&EndDate=2026-10-10');
    expect(r.failedWindows).toBe(1);
    expect(r.notes.join(' ')).toMatch(/not published this monthly Candidate release/);
  });

  it('refuses a UCDP next-page link on another host', async () => {
    process.env.UCDP_ACCESS_TOKEN = 'ucdp-token';
    const fetchImpl = (async (url: string) => {
      if (url.startsWith('https://evil.example')) throw new Error('should not be called');
      return json({ TotalCount: 2, TotalPages: 2, NextPageUrl: 'https://evil.example/steal', Result: [ucdpRow({ date_start: '2026-10-04T00:00:00', date_end: '2026-10-04T00:00:00' })] });
    }) as typeof fetch;
    await expect(queryConflictRange(Date.parse('2026-10-02T00:00:00Z'), NOW, { now, fetchImpl })).rejects.toThrow(/unexpected host/);
  });

  it('flags a pin in a Wikipedia-listed conflict country', async () => {
    const wiki = `${'<!-- padding -->'.repeat(20)}{{flag|Ukraine}} {{flag|Sudan}}`;
    const fetchImpl = (async (url: string) => {
      if (url.includes('wikipedia.org')) return json({ parse: { wikitext: wiki } });
      if (url.includes('eonet')) return json({ events: [] });
      return json({ type: 'FeatureCollection', metadata: { count: 0 }, features: [] });
    }) as typeof fetch;
    const res = await planSafety({ latitude: 48.0, longitude: 37.8, radiusKm: 100, window: '7d', iso2: 'UA' }, { fetchImpl, now });
    expect(res.conflictCountry).toMatchObject({ iso2: 'UA', name: 'Ukraine' });
    expect(res.officialLinks[0]!.url).toBe('https://www.icrc.org/');
    expect(res.limitations.join(' ')).toMatch(/Ukraine/);
    expect(res.guidance.status).toBe('unavailable');
  });
});
