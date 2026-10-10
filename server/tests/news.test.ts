import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { EntitlementStore } from '../src/services/entitlements';
import { __resetNewsCache, countryQuery, getCountryNews, getGlobalNews, mentionsAlias, parseGoogleNewsRss } from '../src/services/news';
import os from 'node:os';
import path from 'node:path';

const item = (title: string, link: string, pubDate = 'Sat, 10 Oct 2026 09:00:00 GMT') =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate></item>`;
const rss = (...items: string[]) => `<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`;

describe('Google News parsing', () => {
  it('splits the publisher off the title and flags headline matches', () => {
    const [a, b] = parseGoogleNewsRss(rss(
      item('Floods hit Japan &amp; Korea - NHK World', 'https://news.google.com/rss/articles/abc?oc=5', 'Sat, 10 Oct 2026 10:00:00 GMT'),
      item('Markets steady in Asia - Reuters', 'https://news.google.com/rss/articles/def'),
    ), ['Japan']);
    expect(a).toMatchObject({ headline: 'Floods hit Japan & Korea', sourceName: 'NHK World', headlineMatch: true, publishedAt: Date.parse('2026-10-10T10:00:00Z') });
    expect(b).toMatchObject({ sourceName: 'Reuters', headlineMatch: false });
  });
  it('drops duplicates, unsafe links and undated items', () => {
    const items = parseGoogleNewsRss(rss(
      item('Same story - A', 'https://example.com/1'),
      item('Same  story! - B', 'https://example.com/2'),
      item('Bad link - C', 'javascript:alert(1)'),
      item('No date - D', 'https://example.com/3', 'not a date'),
      item('<![CDATA[<b>Tagged</b> headline - E]]>', 'https://example.com/4'),
    ), []);
    expect(items.map((i) => i.headline)).toEqual(['Same story', 'Tagged headline']);
  });
  it('rejects a non-RSS response', () => {
    expect(() => parseGoogleNewsRss('<html>nope</html>', [])).toThrow();
  });
  it('matches aliases on word boundaries only', () => {
    expect(mentionsAlias('Oman signs deal', 'Oman')).toBe(true);
    expect(mentionsAlias('Romania signs deal', 'Oman')).toBe(false);
  });
  it('maps ISO codes to search terms', () => {
    expect(countryQuery('us')?.query).toBe('United States');
    expect(countryQuery('JP')?.query).toBe('Japan');
    expect(countryQuery('ZZ')).toBeNull();
  });
});

describe('news cache and staleness', () => {
  beforeEach(() => __resetNewsCache());
  const ok = () => ({ ok: true, status: 200, text: async () => rss(item('Japan news - X', 'https://example.com/a')) }) as unknown as Response;

  it('serves the cache, then marks it stale when Google News fails', async () => {
    let t = 1000;
    let calls = 0;
    const f = (async () => { calls++; return ok(); }) as unknown as typeof fetch;
    const first = await getCountryNews('JP', { fetchImpl: f, now: () => t });
    expect(first.meta.stale).toBe(false);
    await getCountryNews('JP', { fetchImpl: f, now: () => t });
    expect(calls).toBe(1);
    t += 11 * 60_000;
    const failing = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const stale = await getCountryNews('JP', { fetchImpl: failing, now: () => t });
    expect(stale.meta.stale).toBe(true);
    expect(stale.items).toHaveLength(1);
  });
  it('returns 502 when nothing is cached, and 429 when Google News throttles', async () => {
    const failing = (async () => ({ ok: false, status: 500, text: async () => '' })) as unknown as typeof fetch;
    await expect(getCountryNews('FR', { fetchImpl: failing })).rejects.toMatchObject({ status: 502, code: 'upstream_unavailable' });
    const throttled = (async () => ({ ok: false, status: 429, text: async () => '' })) as unknown as typeof fetch;
    await expect(getCountryNews('DE', { fetchImpl: throttled })).rejects.toMatchObject({ status: 429, code: 'news_rate_limited' });
  });
  it('global mode searches disaster keywords and is cached separately from countries', async () => {
    let asked = '';
    const f = (async (url: string) => { asked = url; return { ok: true, status: 200, text: async () => rss(item('Wildfire spreads in Canada - CBC', 'https://example.com/g')) }; }) as unknown as typeof fetch;
    const g = await getGlobalNews({ fetchImpl: f });
    expect(new URL(asked).searchParams.get('q')).toMatch(/earthquake OR wildfire/);
    expect(g).toMatchObject({ country: 'GLOBAL', items: [{ headlineMatch: true }] });
    expect(g.meta.scopeNote).toMatch(/disaster keywords/);
  });
});

describe('GET /api/news', () => {
  const app = createApp({ store: new EntitlementStore(path.join(os.tmpdir(), `impact-news-${Date.now()}.json`)), stripe: () => null });
  it('validates the country code', async () => {
    expect((await request(app).get('/api/news')).status).toBe(400);
    expect((await request(app).get('/api/news?country=USA')).body.error.code).toBe('invalid_country');
    expect((await request(app).get('/api/news?country=ZZ')).body.error.code).toBe('invalid_country');
  });
});
