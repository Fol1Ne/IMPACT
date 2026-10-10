import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetConflictCache } from '../src/services/conflict';
import { __resetConflictCountriesCache } from '../src/services/conflictCountries';
import { __resetEonetCache } from '../src/services/eonet';
import { __resetHistoryCache, eonetBbox, getSafetyHistory } from '../src/services/history';
import { chatCompletion } from '../src/services/openrouter';
import { planSafety } from '../src/services/safety';
import { __resetUsgsRangeCache } from '../src/services/usgs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const now = () => NOW;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const quake = (id: string, mag: number, year: number, lng = 139.8, lat = 35.7) => ({ id, properties: { mag, time: Date.UTC(year, 2, 11), title: `M ${mag} - near Tokyo`, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}` }, geometry: { coordinates: [lng, lat, 20] } });
const eonet = (id: string, category: string, date: string, coords: [number, number][]) => ({
  id, title: `${category} ${id}`, link: `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`, categories: [{ id: category }],
  sources: [{ id: 'JTWC', url: `https://example.org/${id}` }], geometry: coords.map((c, i) => ({ date: `${date}T0${i}:00:00Z`, type: 'Point', coordinates: c })),
});

/** Mock of the USGS count/query and EONET endpoints, recording every URL. */
function history(calls: string[], opts: { eonetDown?: boolean; quakes?: boolean } = {}) {
  const withQuakes = opts.quakes ?? true;
  return (async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/count')) {
      const m = Number(u.searchParams.get('minmagnitude'));
      return json({ count: !withQuakes ? 0 : m >= 7 ? 3 : m >= 6 ? 52 : 4474, maxAllowed: 20000 });
    }
    if (u.hostname.includes('usgs.gov')) {
      if (!withQuakes || !u.searchParams.has('latitude')) return json({ type: 'FeatureCollection', features: [] });
      return json({ type: 'FeatureCollection', features: u.searchParams.get('orderby') === 'magnitude' ? [quake('a', 7.9, 2011), quake('b', 7.1, 1982)] : [quake('c', 4.6, 2026)] });
    }
    if (url.includes('eonet')) {
      if (u.searchParams.get('bbox') === null) return json({ events: [] }); // the recent-window query from getHazards
      if (opts.eonetDown) return json({ error: 'down' }, 503);
      return json({ events: [
        // Storm whose latest point is far away but whose track passed 20 km from Tokyo.
        eonet('S1', 'severeStorms', '2019-10-12', [[139.7, 35.5], [145, 40]]),
        eonet('S2', 'severeStorms', '2025-09-01', [[139.9, 35.9]]),
        eonet('F1', 'floods', '2015-09-10', [[139.6, 35.6]]),
        eonet('FAR', 'wildfires', '2020-01-01', [[150, 20]]),
        eonet('ICE', 'seaLakeIce', '2021-01-01', [[139.7, 35.7]]),
      ] });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

describe('safety history', () => {
  beforeEach(() => { __resetHistoryCache(); __resetEonetCache(); __resetUsgsRangeCache(); __resetConflictCache(); __resetConflictCountriesCache(); });

  it('summarises USGS and EONET records within the radius with server-written facts', async () => {
    const calls: string[] = [];
    const h = await getSafetyHistory(35.68, 139.69, 250, { fetchImpl: history(calls), now });
    expect(h.earthquakes).toMatchObject({ ok: true, total: 4474, strong: 52, major: 3 });
    const q = h.categories[0]!;
    expect(q.category).toBe('earthquakes');
    expect(q.basis).toBe('4,474 earthquakes of M4.5+ recorded by USGS within 250 km since 1976 (52 of M6+, 3 of M7+). Largest: M7.9 in 2011. Most recent M4.5+: 2026-03-11.');
    expect(q.notable.map((n) => n.magnitude)).toEqual([7.9, 7.1]);
    const storms = h.categories.find((c) => c.category === 'severeStorms')!;
    expect(storms).toMatchObject({ count: 2, firstYear: 2019, lastYear: 2025 });
    expect(storms.basis).toBe('Severe storms: 2 events recorded by NASA EONET within 250 km (2019–2025).');
    expect(storms.notable[0]!.url).toBe('https://example.org/S2');
    expect(h.categories.map((c) => c.category)).not.toContain('wildfires');
    expect(h.categories.map((c) => c.category)).not.toContain('seaLakeIce');
    const usgs = new URL(calls.find((c) => c.includes('/count'))!);
    expect(Object.fromEntries(['latitude', 'longitude', 'maxradiuskm', 'starttime', 'endtime'].map((k) => [k, usgs.searchParams.get(k)]))).toEqual({ latitude: '35.68', longitude: '139.69', maxradiuskm: '250', starttime: '1976-01-01', endtime: '2026-10-10' });
    expect(calls.find((c) => c.includes('bbox='))).toContain('start=2000-01-01&end=2026-10-10');
    expect(h.notes.join(' ')).toMatch(/not what will happen/);
  });

  it('keeps earthquake history when EONET fails, and says so', async () => {
    const h = await getSafetyHistory(35.68, 139.69, 250, { fetchImpl: history([], { eonetDown: true }), now });
    expect(h.naturalEvents).toMatchObject({ ok: false });
    expect(h.categories.map((c) => c.category)).toEqual(['earthquakes']);
    expect(h.notes.join(' ')).toMatch(/EONET history could not be loaded/);
  });

  it('clamps the EONET box at the antimeridian', () => {
    expect(eonetBbox(0, 179, 500)).toMatchObject({ clipped: true });
    expect(eonetBbox(35.68, 139.69, 250).bbox).toBe('136.92,37.93,142.46,33.43');
  });
});

describe('safety guidance from history', () => {
  beforeEach(() => { __resetHistoryCache(); __resetEonetCache(); __resetUsgsRangeCache(); __resetConflictCache(); __resetConflictCountriesCache(); process.env.OPENROUTER_API_KEY = 'k'; });
  afterEach(() => { delete process.env.OPENROUTER_API_KEY; });

  it('asks the AI even with no recent events, sends the record, and keeps only recorded categories', async () => {
    let sent = '';
    const ai = (async (_url: string, init?: RequestInit) => {
      sent = String(init!.body);
      return json({ choices: [{ message: { content: JSON.stringify({
        summary: 'No recent events; the area has a long earthquake record.',
        hazards: [],
        watchFor: [
          { category: 'Earthquakes', signs: ['Strong shaking'], prepare: ['Secure heavy furniture.'] },
          { category: 'Volcanoes', signs: ['Ash'], prepare: ['Masks'] },
          { category: 'Severe storms', signs: ['Typhoon warnings'], prepare: ['Keep a radio.'] },
        ],
        potentialIssues: ['Aftershocks may follow a large earthquake.'],
        general: [], uncertainties: [],
      }) } }] });
    }) as unknown as typeof fetch;
    const r = await planSafety({ latitude: 35.68, longitude: 139.69, radiusKm: 250, window: '7d' }, { fetchImpl: history([]), aiFetchImpl: ai, now });
    expect(r.facts).toHaveLength(0);
    expect(r.history?.categories.length).toBeGreaterThan(0);
    const ctx = JSON.parse(JSON.parse(sent).messages[1].content.replace(/^[^{]*/, ''));
    expect(ctx.history.categories[0].record).toMatch(/4,474 earthquakes/);
    expect(r.guidance.status).toBe('ok');
    if (r.guidance.status !== 'ok') return;
    expect(r.guidance.watchFor.map((w) => w.category)).toEqual(['earthquakes', 'severeStorms']);
    expect(r.guidance.watchFor[0]!.basis).toMatch(/^4,474 earthquakes of M4.5\+ recorded by USGS/);
    expect(r.guidance.potentialIssues).toEqual(['Aftershocks may follow a large earthquake.']);
    expect(r.officialLinks.some((l) => l.url.includes('usgs.gov'))).toBe(true);
  });

  it('does not call the AI when there is neither recent activity nor history', async () => {
    let called = false;
    const ai = (async () => { called = true; throw new Error('no'); }) as unknown as typeof fetch;
    const empty = (async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/count')) return json({ count: 0 });
      if (u.hostname.includes('usgs.gov')) return json({ type: 'FeatureCollection', features: [] });
      return json({ events: [] });
    }) as typeof fetch;
    const r = await planSafety({ latitude: -60, longitude: -120, radiusKm: 100, window: '7d' }, { fetchImpl: empty, aiFetchImpl: ai, now });
    expect(called).toBe(false);
    expect(r.guidance.status).toBe('not_generated');
  });
});

describe('OpenRouter model fallback', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('retries on the fallback model when the primary has no credits', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    process.env.OPENROUTER_MODEL = 'openai/gpt-4o';
    process.env.OPENROUTER_FALLBACK_MODEL = 'free/model:free';
    const models: string[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      const m = JSON.parse(String(init!.body)).model as string;
      models.push(m);
      return m === 'openai/gpt-4o' ? json({ error: { code: 402, message: 'Insufficient credits' } }, 402) : json({ choices: [{ message: { content: '{"ok":true}' } }] });
    }) as typeof fetch;
    const r = await chatCompletion([{ role: 'user', content: 'hi' }], { maxTokens: 10, fetchImpl: f });
    expect(models).toEqual(['openai/gpt-4o', 'free/model:free']);
    expect(r.model).toBe('free/model:free');
  });

  it('reports missing credits clearly when there is no fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    process.env.OPENROUTER_MODEL = 'openai/gpt-4o';
    process.env.OPENROUTER_FALLBACK_MODEL = '';
    const f = (async () => json({ error: { code: 402 } }, 402)) as unknown as typeof fetch;
    await expect(chatCompletion([{ role: 'user', content: 'hi' }], { maxTokens: 10, fetchImpl: f })).rejects.toMatchObject({ code: 'ai_no_credits' });
  });
});
