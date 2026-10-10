import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import type { ConflictCountry, ConflictsResponse } from '../../../shared/types';
import { log } from '../logger';

countries.registerLocale(en);

type FetchLike = typeof fetch;
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_PAGE = 'List_of_ongoing_armed_conflicts';
const WIKI_PAGE_TITLE = 'List of ongoing armed conflicts';
export const WIKI_PAGE_URL = 'https://en.wikipedia.org/wiki/List_of_ongoing_armed_conflicts';
const FRESH_MS = 6 * 60 * 60_000;
const USER_AGENT = 'IMPACT/1.0 (https://github.com/Fol1Ne/IMPACT; educational disaster-intelligence app)';

/** Wikipedia flag names that i18n-iso-countries does not resolve on its own. */
const ALIASES: Record<string, string> = {
  'DR Congo': 'CD',
  'Democratic Republic of the Congo': 'CD',
  'Ivory Coast': 'CI',
  'Côte d\'Ivoire': 'CI',
  Palestine: 'PS',
  'State of Palestine': 'PS',
  Syria: 'SY',
  Russia: 'RU',
  Myanmar: 'MM',
  Burma: 'MM',
  Iran: 'IR',
  Laos: 'LA',
  Turkey: 'TR',
  'United States': 'US',
  'United Arab Emirates': 'AE',
  'South Sudan': 'SS',
  'Central African Republic': 'CF',
  'Papua New Guinea': 'PG',
  'Czech Republic': 'CZ',
  Czechia: 'CZ',
  'East Timor': 'TL',
  'Cape Verde': 'CV',
  Eswatini: 'SZ',
  Swaziland: 'SZ',
  Kosovo: 'XK',
};

const FLAG_RE = /\{\{\s*flag(?:icon)?\s*\|\s*([^}|]+)/gi;

export function countryCodeFromWikiName(raw: string): string | null {
  const name = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/^the\s+/i, '').trim();
  if (!name) return null;
  if (ALIASES[name]) return ALIASES[name];
  const lower = Object.keys(ALIASES).find((k) => k.toLowerCase() === name.toLowerCase());
  if (lower) return ALIASES[lower]!;
  return countries.getAlpha2Code(name, 'en') ?? countries.getAlpha2Code(name.replace(/^the\s+/i, ''), 'en') ?? null;
}

export function parseWikiConflictFlags(wikitext: string): { flags: { iso2: string; wikiName: string }[]; unmapped: string[] } {
  const seen = new Set<string>();
  const flags: { iso2: string; wikiName: string }[] = [];
  const unmapped: string[] = [];
  FLAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FLAG_RE.exec(wikitext))) {
    const wikiName = (m[1] ?? '').replace(/_/g, ' ').trim();
    const iso2 = countryCodeFromWikiName(wikiName);
    if (!iso2) { if (wikiName && !unmapped.includes(wikiName)) unmapped.push(wikiName); continue; }
    if (seen.has(iso2)) continue;
    seen.add(iso2);
    flags.push({ iso2, wikiName });
  }
  return { flags: flags.sort((a, b) => a.iso2.localeCompare(b.iso2)), unmapped };
}

/** Camera targets for countries Wikipedia lists; used when the client has no matching globe feature. */
const FALLBACK_VIEW: Record<string, { latitude: number; longitude: number; altitude: number }> = {
  PS: { latitude: 31.9, longitude: 35.2, altitude: 0.45 },
  XK: { latitude: 42.6, longitude: 20.9, altitude: 0.4 },
};

function displayName(iso2: string, wikiName: string): string {
  return countries.getName(iso2, 'en') ?? wikiName;
}

export function toConflictCountries(flags: { iso2: string; wikiName: string }[]): ConflictCountry[] {
  return flags.map(({ iso2, wikiName }) => {
    const view = FALLBACK_VIEW[iso2] ?? { latitude: 0, longitude: 0, altitude: 1.6 };
    return { iso2, name: displayName(iso2, wikiName), ...view };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

interface Cache { data: ConflictsResponse; fetchedAt: number }
let cache: Cache | null = null;
export const __resetConflictCountriesCache = () => { cache = null; };

async function fetchWikitext(fetchImpl: FetchLike): Promise<string> {
  const url = `${WIKI_API}?${new URLSearchParams({
    action: 'parse', page: WIKI_PAGE, prop: 'wikitext', format: 'json', formatversion: '2',
  })}`;
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Wikipedia responded ${res.status}`);
  const json = (await res.json()) as { parse?: { wikitext?: unknown } };
  const text = json.parse?.wikitext;
  if (typeof text !== 'string' || text.length < 200) throw new Error('Wikipedia returned no conflict-list wikitext');
  return text;
}

export async function getConflictCountries(opts: { force?: boolean; fetchImpl?: FetchLike; now?: () => number } = {}): Promise<ConflictsResponse> {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (cache && !opts.force && now() - cache.fetchedAt < FRESH_MS) return cache.data;
  try {
    const wikitext = await fetchWikitext(fetchImpl);
    const { flags, unmapped } = parseWikiConflictFlags(wikitext);
    const data: ConflictsResponse = {
      countries: toConflictCountries(flags),
      meta: {
        source: 'wikipedia',
        sourceUrl: WIKI_PAGE_URL,
        pageTitle: WIKI_PAGE_TITLE,
        fetchedAt: now(),
        stale: false,
        unmappedNames: unmapped,
        notes: [
          'Countries Wikipedia lists as locations of an ongoing armed conflict. This is not an official designation, a front line or a map of territorial control.',
          'The list is independent of the event date filter. Wikipedia updates it on its own schedule and can lag or omit conflicts.',
          ...(unmapped.length ? [`These location names could not be matched to a country code and were skipped: ${unmapped.join(', ')}.`] : []),
        ],
      },
    };
    cache = { data, fetchedAt: now() };
    return data;
  } catch (err) {
    log('warn', 'conflict_countries_failed', { reason: (err as Error).message });
    if (cache) return { ...cache.data, meta: { ...cache.data.meta, stale: true } };
    throw err;
  }
}

export function conflictCountryAt(iso2: string | null | undefined, list: ConflictCountry[]): ConflictCountry | null {
  if (!iso2) return null;
  return list.find((c) => c.iso2 === iso2.toUpperCase()) ?? null;
}
