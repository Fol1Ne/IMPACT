import type { ConflictDetails, HazardEvent, Provider } from '../../../shared/types';
import { getConfig } from '../config';
import { log } from '../logger';

type FetchLike = typeof fetch;
const DAY_MS = 86_400_000;

/** Upper bound on conflict events per request, to keep the globe and payload usable. Newest windows are fetched first. */
export const MAX_CONFLICT_EVENTS = 15_000;
export const ACLED_WINDOW_DAYS = 7;
const ACLED_PAGE_LIMIT = 5000;
const UCDP_PAGE_SIZE = 1000;
const MAX_PAGES_PER_WINDOW = 10;
const CURRENT_FRESH_MS = 30 * 60_000;
const PAST_FRESH_MS = 6 * 60 * 60_000;
const WINDOW_CACHE_MAX = 120;

/** ACLED political-violence event types. Protests, riots and strategic developments are deliberately excluded. */
export const ACLED_EVENT_TYPES = ['Battles', 'Explosions/Remote violence', 'Violence against civilians'] as const;
const ACLED_FIELDS = [
  'event_id_cnty', 'event_date', 'event_type', 'sub_event_type', 'actor1', 'actor2', 'country', 'admin1',
  'location', 'latitude', 'longitude', 'geo_precision', 'source', 'notes', 'fatalities', 'timestamp',
];
const ACLED_GEO_PRECISION: Record<string, string> = {
  '1': 'Coordinates of the named town or village (ACLED precision 1).',
  '2': 'Near the named town or within part of a region (ACLED precision 2).',
  '3': 'Only a larger region was reported; a provincial capital or centroid is used (ACLED precision 3).',
};

const UCDP_VIOLENCE: Record<number, string> = { 1: 'State-based armed conflict', 2: 'Non-state conflict', 3: 'One-sided violence' };
const UCDP_WHERE_PREC: Record<number, string> = {
  1: 'Exact location (UCDP precision 1).',
  2: 'Within about 25 km of the given point (UCDP precision 2).',
  3: 'Second-order administrative area only (UCDP precision 3).',
  4: 'First-order administrative area only (UCDP precision 4).',
  5: 'Linear or ambiguous location, such as a road or border (UCDP precision 5).',
  6: 'Country only (UCDP precision 6).',
  7: 'International waters or airspace (UCDP precision 7).',
};

const toNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : null);
/** Provider dates are calendar days without a zone; treat them as UTC midnight. */
const utcDay = (v: unknown): number | null => {
  const s = typeof v === 'string' ? v.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
};
const validPoint = (lat: number | null, lng: number | null): boolean => lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function activeConflictProvider(): Extract<Provider, 'acled' | 'ucdp'> | null {
  const c = getConfig();
  if (c.acled.username && c.acled.password) return 'acled';
  if (c.ucdp.token) return 'ucdp';
  return null;
}

// ---- normalisation ---------------------------------------------------------

export function normalizeAcledRow(raw: unknown): HazardEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.event_id_cnty, 40);
  const eventType = str(r.event_type, 60);
  const date = utcDay(r.event_date);
  const lat = toNum(r.latitude);
  const lng = toNum(r.longitude);
  if (!id || !eventType || date === null || !validPoint(lat, lng)) return null;
  if (!(ACLED_EVENT_TYPES as readonly string[]).includes(eventType)) return null;

  const sub = str(r.sub_event_type, 80);
  const location = str(r.location, 120);
  const admin1 = str(r.admin1, 120);
  const country = str(r.country, 80);
  const fatalities = toNum(r.fatalities);
  const conflict: ConflictDetails = {
    eventType,
    subEventType: sub,
    actors: [str(r.actor1, 160), str(r.actor2, 160)].filter((a): a is string => a !== null),
    fatalities,
    country,
    admin1,
    locationPrecision: ACLED_GEO_PRECISION[String(toNum(r.geo_precision))] ?? null,
    battle: eventType === 'Battles',
  };
  return {
    id: `acled:${id}`,
    title: `${sub ?? eventType}: ${[location, country].filter(Boolean).join(', ') || 'location not given'}`,
    category: 'conflict',
    latitude: lat!,
    longitude: lng!,
    geometryType: 'point',
    track: [],
    startTime: date,
    updatedTime: date,
    closedTime: null,
    severity: fatalities === null ? null : { value: fatalities, unit: 'reported fatalities', provider: 'acled' },
    place: [location, admin1, country].filter(Boolean).join(', ') || null,
    description: str(r.notes, 600),
    sources: [{ provider: 'acled', providerId: id, url: null, label: 'ACLED event record', ...(str(r.source, 200) ? { origin: str(r.source, 200)! } : {}) }],
    quake: null,
    match: null,
    conflict,
  };
}

export function normalizeUcdpRow(raw: unknown): HazardEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const idNum = toNum(r.id);
  const type = toNum(r.type_of_violence);
  const start = utcDay(r.date_start);
  const end = utcDay(r.date_end) ?? start;
  const lat = toNum(r.latitude);
  const lng = toNum(r.longitude);
  if (idNum === null || type === null || !UCDP_VIOLENCE[type] || start === null || !validPoint(lat, lng)) return null;
  const id = String(idNum);
  const eventType = UCDP_VIOLENCE[type];
  const where = str(r.where_description, 120) ?? str(r.adm_1, 120);
  const country = str(r.country, 80);
  const best = toNum(r.best);
  const precision = toNum(r.where_prec);
  return {
    id: `ucdp:${id}`,
    title: `${eventType}: ${[where, country].filter(Boolean).join(', ') || 'location not given'}`,
    category: 'conflict',
    latitude: lat!,
    longitude: lng!,
    geometryType: 'point',
    track: [],
    startTime: start,
    updatedTime: end,
    closedTime: null,
    severity: best === null ? null : { value: best, unit: 'estimated deaths (UCDP best)', provider: 'ucdp' },
    place: [where, str(r.adm_1, 120), country].filter(Boolean).join(', ') || null,
    description: str(r.dyad_name, 300),
    sources: [{ provider: 'ucdp', providerId: id, url: null, label: 'UCDP Candidate event record' }],
    quake: null,
    match: null,
    conflict: {
      eventType,
      subEventType: str(r.conflict_name, 160),
      actors: [str(r.side_a, 160), str(r.side_b, 160)].filter((a): a is string => a !== null),
      fatalities: best,
      country,
      admin1: str(r.adm_1, 120),
      locationPrecision: precision !== null ? UCDP_WHERE_PREC[precision] ?? null : null,
      battle: type === 1 || type === 2,
    },
  };
}

// ---- ACLED -----------------------------------------------------------------

let acledToken: { token: string; expiresAt: number } | null = null;

async function getAcledToken(fetchImpl: FetchLike, now: () => number): Promise<string> {
  if (acledToken && acledToken.expiresAt - 5 * 60_000 > now()) return acledToken.token;
  const { username, password, baseUrl } = getConfig().acled;
  const body = new URLSearchParams({ username, password, grant_type: 'password', client_id: 'acled', scope: 'authenticated' });
  const res = await fetchImpl(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 400 || res.status === 401) throw new Error('ACLED rejected the configured email or password');
  if (res.status === 403) throw new Error('This ACLED account does not have API access; complete the myACLED profile and request access');
  if (!res.ok) throw new Error(`ACLED login responded ${res.status}`);
  const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  const token = str(json.access_token, 4000);
  if (!token) throw new Error('ACLED login returned no access token');
  const ttl = toNum(json.expires_in) ?? 86_400;
  acledToken = { token, expiresAt: now() + ttl * 1000 };
  return token;
}

function acledUrl(start: string, end: string, cursor: string | number): string {
  const types = ACLED_EVENT_TYPES.map((t) => `event_type=${encodeURIComponent(t)}`).join(':OR:');
  return `${getConfig().acled.baseUrl}/api/acled/read?_format=json&event_date=${start}|${end}&event_date_where=BETWEEN&${types}`
    + `&fields=${ACLED_FIELDS.join('|')}&limit=${ACLED_PAGE_LIMIT}&cursor=${encodeURIComponent(String(cursor))}`;
}

interface PageResult { rows: unknown[]; next: string | null; restriction: string | null }

async function fetchAcledPage(url: string, ctx: Ctx, retried = false): Promise<PageResult> {
  const token = await getAcledToken(ctx.fetchImpl, ctx.now);
  const res = await ctx.fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
  if (res.status === 401 && !retried) { acledToken = null; return fetchAcledPage(url, ctx, true); }
  if (res.status === 403) throw new Error('ACLED denied data access for this account');
  if (res.status === 429) throw new Error('ACLED rate limit reached');
  if (!res.ok) throw new Error(`ACLED responded ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json.success === false || !Array.isArray(json.data)) throw new Error('Unexpected ACLED response shape');
  const next = json.next_cursor === null || json.next_cursor === undefined || json.next_cursor === '' ? null : String(json.next_cursor);
  const restriction = json.data_query_restrictions ? str(typeof json.data_query_restrictions === 'string' ? json.data_query_restrictions : JSON.stringify(json.data_query_restrictions), 400) : null;
  return { rows: json.data, next, restriction };
}

// ---- UCDP Candidate ------------------------------------------------------

/** Monthly Candidate releases are versioned YY.0.M (for example 26.0.8 for August 2026). */
export function ucdpMonthlyVersions(start: number, end: number): { version: string; start: string; end: string; endMs: number }[] {
  const out: { version: string; start: string; end: string; endMs: number }[] = [];
  const s = new Date(start);
  let y = new Date(end).getUTCFullYear();
  let m = new Date(end).getUTCMonth();
  while (y > s.getUTCFullYear() || (y === s.getUTCFullYear() && m >= s.getUTCMonth())) {
    const monthStart = Date.UTC(y, m, 1);
    const monthEnd = Date.UTC(y, m + 1, 1) - DAY_MS;
    out.push({ version: `${y % 100}.0.${m + 1}`, start: day(Math.max(monthStart, start)), end: day(Math.min(monthEnd, end)), endMs: Math.min(monthEnd + DAY_MS - 1, end) });
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return out;
}

async function fetchUcdpPage(url: string, ctx: Ctx): Promise<PageResult> {
  const { baseUrl, token } = getConfig().ucdp;
  if (!url.startsWith(`${baseUrl}/`)) throw new Error('UCDP returned a next-page link on an unexpected host');
  const res = await ctx.fetchImpl(url, { headers: { 'x-ucdp-access-token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
  if (res.status === 401 || res.status === 403) throw new Error('UCDP rejected the configured access token');
  if (res.status === 404) throw new Error('UCDP has not published this monthly Candidate release yet');
  if (res.status === 429) throw new Error('UCDP daily request quota reached');
  if (!res.ok) throw new Error(`UCDP responded ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (!Array.isArray(json.Result)) throw new Error('Unexpected UCDP response shape');
  const next = str(json.NextPageUrl, 600);
  return { rows: json.Result, next: json.Result.length > 0 ? next : null, restriction: null };
}

// ---- window fetching -----------------------------------------------------

interface Ctx { force?: boolean; fetchImpl: FetchLike; now: () => number }
interface Window { key: string; endMs: number; firstUrl: string; nextUrl: (next: string) => string }
interface WindowEntry { events: HazardEvent[]; fetchedAt: number; truncated: boolean; restriction: string | null }
const windowCache = new Map<string, WindowEntry>();
export const __resetConflictCache = () => { windowCache.clear(); acledToken = null; };

function acledWindows(start: number, end: number): Window[] {
  const out: Window[] = [];
  const first = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate());
  let we = Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate());
  while (we >= first) {
    const ws = Math.max(first, we - (ACLED_WINDOW_DAYS - 1) * DAY_MS);
    const s = day(ws);
    const e = day(we);
    out.push({ key: `acled:${s}:${e}`, endMs: we + DAY_MS - 1, firstUrl: acledUrl(s, e, 0), nextUrl: (cursor) => acledUrl(s, e, cursor) });
    we = ws - DAY_MS;
  }
  return out;
}

function ucdpWindows(start: number, end: number): Window[] {
  const base = getConfig().ucdp.baseUrl;
  return ucdpMonthlyVersions(start, end).map((v) => ({
    key: `ucdp:${v.version}:${v.start}:${v.end}`,
    endMs: v.endMs,
    firstUrl: `${base}/api/gedevents/${v.version}?pagesize=${UCDP_PAGE_SIZE}&StartDate=${v.start}&EndDate=${v.end}`,
    nextUrl: (url) => url,
  }));
}

async function fetchWindow(provider: 'acled' | 'ucdp', w: Window, ctx: Ctx): Promise<{ entry: WindowEntry; stale: boolean } | { error: string }> {
  const cached = windowCache.get(w.key);
  const freshFor = w.endMs < ctx.now() - DAY_MS ? PAST_FRESH_MS : CURRENT_FRESH_MS;
  if (cached && !ctx.force && ctx.now() - cached.fetchedAt < freshFor) return { entry: cached, stale: false };
  try {
    const events: HazardEvent[] = [];
    let restriction: string | null = null;
    let url: string | null = w.firstUrl;
    let pages = 0;
    while (url && pages < MAX_PAGES_PER_WINDOW) {
      const page: PageResult = provider === 'acled' ? await fetchAcledPage(url, ctx) : await fetchUcdpPage(url, ctx);
      pages++;
      restriction ??= page.restriction;
      for (const row of page.rows) {
        const e = provider === 'acled' ? normalizeAcledRow(row) : normalizeUcdpRow(row);
        if (e) events.push(e);
      }
      url = page.next === null ? null : w.nextUrl(page.next);
    }
    const entry = { events, fetchedAt: ctx.now(), truncated: url !== null, restriction };
    if (windowCache.size >= WINDOW_CACHE_MAX) windowCache.delete(windowCache.keys().next().value as string);
    windowCache.set(w.key, entry);
    return { entry, stale: false };
  } catch (err) {
    log('warn', 'conflict_window_failed', { window: w.key, reason: (err as Error).message });
    if (cached) return { entry: cached, stale: true };
    return { error: (err as Error).message };
  }
}

export interface ConflictResult {
  provider: 'acled' | 'ucdp';
  events: HazardEvent[];
  fetchedAt: number | null;
  stale: boolean;
  failedWindows: number;
  windows: number;
  /** True when the event cap was reached before the oldest windows were loaded. */
  capped: boolean;
  notes: string[];
}

/** Political-violence events in [start, end] from whichever conflict source is configured. Returns null when none is. */
export async function queryConflictRange(start: number, end: number, opts: { force?: boolean; fetchImpl?: FetchLike; now?: () => number } = {}): Promise<ConflictResult | null> {
  const provider = activeConflictProvider();
  if (!provider) return null;
  const ctx: Ctx = { force: opts.force, fetchImpl: opts.fetchImpl ?? fetch, now: opts.now ?? Date.now };
  const windows = provider === 'acled' ? acledWindows(start, end) : ucdpWindows(start, end);

  const byId = new Map<string, HazardEvent>();
  let fetchedAt: number | null = null;
  let stale = false;
  let failed = 0;
  let loaded = 0;
  let truncated = false;
  const errors = new Set<string>();
  const restrictions = new Set<string>();
  // Sequential, newest first: the cap then keeps the most recent events, and ACLED is not hammered in parallel.
  for (const w of windows) {
    if (byId.size >= MAX_CONFLICT_EVENTS) break;
    const r = await fetchWindow(provider, w, ctx);
    loaded++;
    if ('error' in r) { failed++; errors.add(r.error); continue; }
    stale ||= r.stale;
    truncated ||= r.entry.truncated;
    if (r.entry.restriction) restrictions.add(r.entry.restriction);
    fetchedAt = fetchedAt === null ? r.entry.fetchedAt : Math.min(fetchedAt, r.entry.fetchedAt);
    for (const e of r.entry.events) if (e.startTime !== null && e.startTime <= end && (e.updatedTime ?? e.startTime) >= start - DAY_MS) byId.set(e.id, e);
  }
  if (failed === loaded) throw new Error([...errors][0] ?? `${provider.toUpperCase()} could not be reached`);

  const capped = loaded < windows.length;
  const notes: string[] = [];
  if (provider === 'acled') notes.push(`ACLED political-violence events only (${ACLED_EVENT_TYPES.join(', ')}). Protests and riots are not shown.`);
  else notes.push('UCDP Candidate events: preliminary monthly releases, usually published with a lag of about a month, so recent weeks may be empty.');
  if (capped) notes.push(`Only the most recent ${MAX_CONFLICT_EVENTS.toLocaleString('en-US')} conflict events are shown; older parts of this range were not loaded. Pick a shorter range for complete coverage.`);
  if (truncated) notes.push('At least one week had more events than this app loads per window, so some events are missing.');
  if (failed) notes.push(`${failed} of ${loaded} date windows could not be loaded (${[...errors].join('; ')}).`);
  for (const r of restrictions) notes.push(`ACLED applied a data restriction to this account: ${r}`);
  return { provider, events: [...byId.values()], fetchedAt, stale, failedWindows: failed, windows: windows.length, capped, notes };
}
