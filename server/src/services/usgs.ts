import { FEEDS, type EventsResponse, type FeedId, type QuakeEvent } from '../../../shared/types';
import { HttpError } from '../errors';
import { log } from '../logger';

export const USGS_FEED_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
export const USGS_QUERY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const FRESH_MS = 60_000;

type FetchLike = typeof fetch;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const safeUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Convert one GeoJSON feature into a QuakeEvent. Returns null when it has no usable id/coordinates. */
export function normalizeFeature(f: unknown): QuakeEvent | null {
  if (!f || typeof f !== 'object') return null;
  const feat = f as { id?: unknown; properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };
  const id = str(feat.id);
  const coords = feat.geometry?.coordinates;
  if (!id || !Array.isArray(coords)) return null;
  const lon = num(coords[0]);
  const lat = num(coords[1]);
  if (lon === null || lat === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const p = feat.properties ?? {};
  const place = str(p.place);
  const mag = num(p.mag);
  return {
    id,
    title: str(p.title) ?? (mag !== null ? `M ${mag.toFixed(1)}${place ? ` - ${place}` : ''}` : (place ?? 'Earthquake')),
    magnitude: mag,
    magType: str(p.magType),
    place,
    time: num(p.time),
    updated: num(p.updated),
    longitude: lon,
    latitude: lat,
    depthKm: num(coords[2]),
    url: safeUrl(p.url),
    status: str(p.status),
    significance: num(p.sig),
    alert: str(p.alert),
    tsunami: p.tsunami === 1 ? true : p.tsunami === 0 ? false : null,
    felt: num(p.felt),
    network: str(p.net),
  };
}

export function normalizeFeed(json: unknown): { events: QuakeEvent[]; generated: number | null } {
  const j = json as { features?: unknown; metadata?: { generated?: unknown } } | null;
  if (!j || !Array.isArray(j.features)) throw new Error('Unexpected USGS response shape');
  const events = j.features.map(normalizeFeature).filter((e): e is QuakeEvent => e !== null);
  return { events, generated: num(j.metadata?.generated) };
}

interface CacheEntry { events: QuakeEvent[]; generated: number | null; fetchedAt: number }
const cache = new Map<FeedId, CacheEntry>();
export const __resetUsgsCache = () => cache.clear();

function buildResponse(feed: FeedId, c: CacheEntry, stale: boolean, staleReason?: string): EventsResponse {
  return {
    events: c.events,
    meta: {
      feed, feedLabel: FEEDS[feed].label, coverage: FEEDS[feed].coverage,
      source: 'USGS Earthquake Hazards Program', sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/',
      feedGeneratedAt: c.generated, fetchedAt: c.fetchedAt, stale, staleReason, count: c.events.length,
    },
  };
}

export async function getEvents(feed: FeedId, opts: { force?: boolean; fetchImpl?: FetchLike; now?: () => number } = {}): Promise<EventsResponse> {
  const now = opts.now ?? Date.now;
  const f = opts.fetchImpl ?? fetch;
  const cached = cache.get(feed);
  if (cached && !opts.force && now() - cached.fetchedAt < FRESH_MS) return buildResponse(feed, cached, false);
  try {
    const res = await f(`${USGS_FEED_BASE}${feed}.geojson`, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`USGS responded ${res.status}`);
    const { events, generated } = normalizeFeed(await res.json());
    const entry = { events, generated, fetchedAt: now() };
    cache.set(feed, entry);
    return buildResponse(feed, entry, false);
  } catch (err) {
    log('warn', 'usgs_fetch_failed', { feed, reason: (err as Error).message });
    if (cached) return buildResponse(feed, cached, true, 'USGS could not be reached; showing the last data retrieved.');
    throw new HttpError(502, 'upstream_unavailable', 'The USGS earthquake feed is unavailable and no earlier data is stored. Try again shortly.');
  }
}

// ---- date-range queries (FDSN event service) ----------------------------

export const USGS_QUERY_LIMIT = 20_000;
const RANGE_FRESH_MS = 2 * 60_000;
const PAST_RANGE_FRESH_MS = 60 * 60_000;
const RANGE_CACHE_MAX = 24;
const BUCKET_MS = 5 * 60_000;

interface RangeEntry { events: QuakeEvent[]; fetchedAt: number }
const rangeCache = new Map<string, RangeEntry>();
export const __resetUsgsRangeCache = () => rangeCache.clear();

export interface UsgsRangeResult { events: QuakeEvent[]; fetchedAt: number; stale: boolean }

export function buildRangeUrl(start: number, end: number, minMagnitude: number): string {
  const u = new URL(USGS_QUERY_URL);
  u.searchParams.set('format', 'geojson');
  u.searchParams.set('starttime', new Date(start).toISOString());
  u.searchParams.set('endtime', new Date(end).toISOString());
  u.searchParams.set('minmagnitude', String(minMagnitude));
  u.searchParams.set('orderby', 'time');
  u.searchParams.set('limit', String(USGS_QUERY_LIMIT));
  return u.toString();
}

/**
 * Earthquakes between two instants at or above a magnitude, via the documented FDSN query API.
 * Start/end are bucketed to 5 minutes so nearby requests share one cache entry.
 */
export async function queryUsgsRange(start: number, end: number, minMagnitude: number, opts: { force?: boolean; fetchImpl?: FetchLike; now?: () => number } = {}): Promise<UsgsRangeResult> {
  const now = opts.now ?? Date.now;
  const s = Math.floor(start / BUCKET_MS) * BUCKET_MS;
  const e = Math.ceil(end / BUCKET_MS) * BUCKET_MS;
  const key = `${s}:${e}:${minMagnitude}`;
  const cached = rangeCache.get(key);
  const freshFor = e < now() - BUCKET_MS ? PAST_RANGE_FRESH_MS : RANGE_FRESH_MS;
  if (cached && !opts.force && now() - cached.fetchedAt < freshFor) return { ...cached, stale: false };
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(buildRangeUrl(s, e, minMagnitude), { signal: AbortSignal.timeout(25_000), headers: { Accept: 'application/json' } });
    if (res.status === 400) throw new HttpError(400, 'usgs_query_rejected', 'USGS rejected this query, usually because it matches more than 20,000 events. Raise the minimum magnitude or shorten the range.');
    if (!res.ok) throw new Error(`USGS responded ${res.status}`);
    const entry = { events: normalizeFeed(await res.json()).events, fetchedAt: now() };
    if (rangeCache.size >= RANGE_CACHE_MAX) rangeCache.delete(rangeCache.keys().next().value as string);
    rangeCache.set(key, entry);
    return { ...entry, stale: false };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    log('warn', 'usgs_range_failed', { reason: (err as Error).message });
    if (cached) return { ...cached, stale: true };
    throw new HttpError(502, 'upstream_unavailable', 'The USGS earthquake service is unavailable and no earlier data is stored for this range.');
  }
}

export const isValidEventId = (id: string) => /^[a-z0-9]{4,40}$/i.test(id);

/** Find an event in any cached feed or range, else ask USGS for that single event by id. */
export async function getEventById(id: string, opts: { fetchImpl?: FetchLike } = {}): Promise<QuakeEvent | null> {
  if (!isValidEventId(id)) throw new HttpError(400, 'invalid_event_id', 'Event id is not valid.');
  for (const c of [...cache.values(), ...rangeCache.values()]) {
    const hit = c.events.find((e) => e.id === id);
    if (hit) return hit;
  }
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(`${USGS_QUERY_URL}?eventid=${encodeURIComponent(id)}&format=geojson`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404 || res.status === 204 || res.status === 400) return null;
    if (!res.ok) throw new Error(`USGS responded ${res.status}`);
    return normalizeFeature(await res.json());
  } catch (err) {
    log('warn', 'usgs_event_lookup_failed', { id, reason: (err as Error).message });
    throw new HttpError(502, 'upstream_unavailable', 'USGS could not be reached to look up that event.');
  }
}
