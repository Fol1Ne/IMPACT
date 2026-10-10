import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import type { NewsItem, NewsResponse } from '../../../shared/types';
import { HttpError } from '../errors';
import { log } from '../logger';

countries.registerLocale(en);

export const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search';
const FRESH_MS = 10 * 60_000;
const MAX_ITEMS = 15;
const SCOPE_NOTE =
  'Headlines come from a Google News keyword search for the country name over the past 7 days. A result is not a guarantee that the article is about events inside that country, and it is not a verified incident list. Headlines that name the country are marked separately from looser keyword hits.';

type FetchLike = typeof fetch;
interface CountryQuery { query: string; aliases: string[] }

const OVERRIDES: Record<string, CountryQuery> = {
  US: { query: 'United States', aliases: ['United States', 'U.S.', 'USA'] },
  GB: { query: 'United Kingdom', aliases: ['United Kingdom', 'Britain', 'British', 'UK'] },
  KR: { query: 'South Korea', aliases: ['South Korea', 'Republic of Korea'] },
  KP: { query: 'North Korea', aliases: ['North Korea', 'DPRK'] },
  RU: { query: 'Russia', aliases: ['Russia', 'Russian'] },
  CZ: { query: 'Czechia', aliases: ['Czechia', 'Czech Republic'] },
  CI: { query: 'Ivory Coast', aliases: ['Ivory Coast', "Côte d'Ivoire", "Cote d'Ivoire"] },
  SY: { query: 'Syria', aliases: ['Syria', 'Syrian'] },
  IR: { query: 'Iran', aliases: ['Iran', 'Iranian'] },
  LA: { query: 'Laos', aliases: ['Laos', 'Lao'] },
  VN: { query: 'Vietnam', aliases: ['Vietnam', 'Vietnamese'] },
  TZ: { query: 'Tanzania', aliases: ['Tanzania'] },
  BO: { query: 'Bolivia', aliases: ['Bolivia'] },
  VE: { query: 'Venezuela', aliases: ['Venezuela'] },
  MD: { query: 'Moldova', aliases: ['Moldova'] },
  TW: { query: 'Taiwan', aliases: ['Taiwan'] },
  BN: { query: 'Brunei', aliases: ['Brunei'] },
  CD: { query: 'Democratic Republic of Congo', aliases: ['Congo', 'DRC'] },
  CG: { query: 'Republic of Congo', aliases: ['Congo'] },
  AE: { query: 'United Arab Emirates', aliases: ['United Arab Emirates', 'UAE'] },
  NL: { query: 'Netherlands', aliases: ['Netherlands', 'Dutch'] },
  TR: { query: 'Turkey', aliases: ['Turkey', 'Türkiye', 'Turkiye'] },
  PS: { query: 'Palestine', aliases: ['Palestine', 'Palestinian', 'Gaza', 'West Bank'] },
  MK: { query: 'North Macedonia', aliases: ['North Macedonia', 'Macedonia'] },
  FK: { query: 'Falkland Islands', aliases: ['Falkland', 'Falklands'] },
};

export function countryQuery(iso2: string): CountryQuery | null {
  const code = iso2.toUpperCase();
  if (OVERRIDES[code]) return OVERRIDES[code];
  const name = countries.getName(code, 'en');
  return name ? { query: name, aliases: [name] } : null;
}

// ---- text helpers -------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
    const code = body[0] !== '#' ? NaN : body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (body[0] === '#') return Number.isInteger(code) && code >= 32 && code !== 127 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

export function plainText(input: string, maxLength = 240): string {
  const text = decodeEntities(input.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function safeLink(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function mentionsAlias(title: string, alias: string): boolean {
  const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(title);
}

function stableId(value: string): string {
  let hash = 0;
  for (const ch of value) hash = Math.imul(31, hash) + ch.charCodeAt(0);
  return `gn-${(hash >>> 0).toString(16)}`;
}

const headlineKey = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---- Google News RSS ----------------------------------------------------

function rssTag(block: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m?.[1] ? m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim() : '';
}

/** Google News titles end with " - Publisher"; split that off into the source name. */
function splitTitle(title: string): { headline: string; sourceName: string } {
  const at = title.lastIndexOf(' - ');
  if (at <= 0) return { headline: title, sourceName: 'Google News' };
  return { headline: title.slice(0, at).trim(), sourceName: title.slice(at + 3).trim() || 'Google News' };
}

export function parseGoogleNewsRss(xml: string, aliases: string[]): NewsItem[] {
  if (!xml.includes('<rss') && !xml.includes('<item>')) throw new Error('Unexpected Google News feed shape');
  const items: NewsItem[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const url = safeLink(decodeEntities(rssTag(block, 'link')));
    const publishedAt = Date.parse(rssTag(block, 'pubDate'));
    const { headline, sourceName } = splitTitle(plainText(rssTag(block, 'title')));
    if (!url || !headline || !Number.isFinite(publishedAt)) continue;
    const key = headlineKey(headline);
    if (seenUrls.has(url) || seenTitles.has(key)) continue;
    seenUrls.add(url);
    seenTitles.add(key);
    items.push({ id: stableId(url), headline, sourceName, publishedAt, url, headlineMatch: aliases.some((a) => mentionsAlias(headline, a)) });
  }
  return items.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_ITEMS);
}

interface CacheEntry { countryName: string; items: NewsItem[]; fetchedAt: number }
const cache = new Map<string, CacheEntry>();
export const __resetNewsCache = () => cache.clear();

function buildResponse(country: string, c: CacheEntry, stale: boolean, staleReason: string | undefined, scopeNote: string): NewsResponse {
  return {
    country, countryName: c.countryName, items: c.items,
    meta: { source: 'Google News', scopeNote, fetchedAt: c.fetchedAt, stale, staleReason },
  };
}

type NewsOpts = { force?: boolean; fetchImpl?: FetchLike; now?: () => number };

export const GLOBAL_KEY = 'GLOBAL';
const GLOBAL_TERMS = ['earthquake', 'wildfire', 'flood', 'hurricane', 'typhoon', 'cyclone', 'volcano', 'tsunami', 'landslide', 'drought'];
const GLOBAL_SCOPE_NOTE =
  'With no country selected, headlines come from a Google News search for disaster keywords (earthquake, wildfire, flood, storm, volcano and similar) over the past 2 days. It is a sample, not an exhaustive or verified list. Headlines that name one of those hazards are marked as matches.';

export async function getCountryNews(iso2: string, opts: NewsOpts = {}): Promise<NewsResponse> {
  const code = iso2.toUpperCase();
  const q = countryQuery(code);
  if (!q) throw new HttpError(400, 'invalid_country', 'That code is not a known ISO country.');
  return fetchNews(code, q.query, `"${q.query}" when:7d`, q.aliases, SCOPE_NOTE, opts);
}

export function getGlobalNews(opts: NewsOpts = {}): Promise<NewsResponse> {
  return fetchNews(GLOBAL_KEY, 'Global', `(${GLOBAL_TERMS.join(' OR ')}) when:2d`, GLOBAL_TERMS, GLOBAL_SCOPE_NOTE, opts);
}

async function fetchNews(code: string, countryName: string, search: string, aliases: string[], scopeNote: string, opts: NewsOpts): Promise<NewsResponse> {
  const now = opts.now ?? Date.now;
  const f = opts.fetchImpl ?? fetch;
  const cached = cache.get(code);
  if (cached && !opts.force && now() - cached.fetchedAt < FRESH_MS) return buildResponse(code, cached, false, undefined, scopeNote);

  const url = new URL(GOOGLE_NEWS_RSS);
  url.searchParams.set('q', search);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');
  try {
    const res = await f(url.toString(), { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (res.status === 429 || res.status === 503) throw new HttpError(429, 'news_rate_limited', 'Google News is limiting requests right now. Wait a minute and try again.');
    if (!res.ok) throw new Error(`Google News responded ${res.status}`);
    const entry = { countryName, items: parseGoogleNewsRss(await res.text(), aliases), fetchedAt: now() };
    cache.set(code, entry);
    return buildResponse(code, entry, false, undefined, scopeNote);
  } catch (err) {
    log('warn', 'news_fetch_failed', { country: code, reason: (err as Error).message });
    if (cached) return buildResponse(code, cached, true, 'Google News could not be reached; showing the last headlines retrieved.', scopeNote);
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'upstream_unavailable', 'Google News is unavailable and no earlier headlines are stored. Try again shortly.');
  }
}
