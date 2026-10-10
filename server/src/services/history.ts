import { CATEGORIES, haversineKm, type HazardCategory, type HazardEvent, type HistoryCategory, type HistoryEvent, type SafetyHistory } from '../../../shared/types';
import { getConfig } from '../config';
import { log } from '../logger';
import { normalizeEonetResponse } from './eonet';
import { USGS_QUERY_URL, normalizeFeed } from './usgs';

type FetchLike = typeof fetch;

/** ComCat is reasonably complete worldwide for M4.5+ from the mid-1970s; earlier small events are patchy. */
export const QUAKE_HISTORY_START = '1976-01-01';
export const QUAKE_HISTORY_MIN_MAG = 4.5;
export const EONET_HISTORY_START = '2000-01-01';
const NOTABLE_QUAKES = 8;
const NOTABLE_PER_CATEGORY = 3;
const FRESH_MS = 24 * 60 * 60_000;
const CACHE_MAX = 60;
/** EONET categories that describe threats to people. Sea/lake ice and water colour are left out. */
const HISTORY_CATEGORIES = new Set<HazardCategory>(['wildfires', 'volcanoes', 'floods', 'severeStorms', 'drought', 'landslides', 'dustHaze', 'snow', 'tempExtremes', 'manmade']);

const year = (ms: number | null) => (ms === null ? null : new Date(ms).getUTCFullYear());
const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

interface Entry { value: SafetyHistory; fetchedAt: number }
const cache = new Map<string, Entry>();
export const __resetHistoryCache = () => cache.clear();

function usgsUrl(kind: 'count' | 'query', lat: number, lng: number, radiusKm: number, end: string, extra: Record<string, string>): string {
  const u = new URL(kind === 'count' ? USGS_QUERY_URL.replace(/query$/, 'count') : USGS_QUERY_URL);
  u.searchParams.set('format', 'geojson');
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lng));
  u.searchParams.set('maxradiuskm', String(radiusKm));
  u.searchParams.set('starttime', QUAKE_HISTORY_START);
  u.searchParams.set('endtime', end);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

async function getJson(url: string, f: FetchLike, timeoutMs: number): Promise<unknown> {
  const res = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`responded ${res.status}`);
  return res.json();
}

async function quakeHistory(lat: number, lng: number, radiusKm: number, end: string, f: FetchLike) {
  const count = async (minmagnitude: number) => {
    const j = (await getJson(usgsUrl('count', lat, lng, radiusKm, end, { minmagnitude: String(minmagnitude) }), f, 20_000)) as { count?: unknown };
    if (typeof j.count !== 'number') throw new Error('unexpected count response');
    return j.count;
  };
  const list = async (orderby: 'magnitude' | 'time', limit: number) =>
    normalizeFeed(await getJson(usgsUrl('query', lat, lng, radiusKm, end, { minmagnitude: String(QUAKE_HISTORY_MIN_MAG), orderby, limit: String(limit) }), f, 25_000)).events;
  const [total, strong, major, largest, latest] = await Promise.all([count(QUAKE_HISTORY_MIN_MAG), count(6), count(7), list('magnitude', NOTABLE_QUAKES), list('time', 1)]);
  return { total, strong, major, largest, latest: latest[0] ?? null };
}

/** Bounding box for EONET (upper-left lon,lat then lower-right lon,lat), clamped at the poles and the antimeridian. */
export function eonetBbox(lat: number, lng: number, radiusKm: number): { bbox: string; clipped: boolean } {
  const dLat = radiusKm / 111;
  const dLng = Math.min(180, radiusKm / (111 * Math.max(0.05, Math.cos((lat * Math.PI) / 180))));
  const west = lng - dLng;
  const east = lng + dLng;
  const clipped = west < -180 || east > 180;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { bbox: [r(Math.max(-180, west)), r(Math.min(90, lat + dLat)), r(Math.min(180, east)), r(Math.max(-90, lat - dLat))].join(','), clipped };
}

/** Closest reported position of an event (storm tracks pass by; the latest point alone can be far away). */
function closestKm(e: HazardEvent, lat: number, lng: number): number {
  let best = haversineKm(lat, lng, e.latitude, e.longitude);
  for (const [tLng, tLat] of e.track) best = Math.min(best, haversineKm(lat, lng, tLat, tLng));
  return best;
}

async function naturalHistory(lat: number, lng: number, radiusKm: number, end: string, f: FetchLike) {
  const { bbox, clipped } = eonetBbox(lat, lng, radiusKm);
  const url = `${getConfig().eonetBaseUrl}/events?status=all&bbox=${bbox}&start=${EONET_HISTORY_START}&end=${end}`;
  const events = normalizeEonetResponse(await getJson(url, f, 45_000))
    .filter((e) => HISTORY_CATEGORIES.has(e.category))
    .map((e) => ({ e, d: closestKm(e, lat, lng) }))
    .filter((x) => x.d <= radiusKm);
  return { events, clipped };
}

function quakeCategory(q: Awaited<ReturnType<typeof quakeHistory>>, radiusKm: number, lat: number, lng: number): HistoryCategory | null {
  if (q.total === 0) return null;
  const top = q.largest[0];
  const parts = [`${plural(q.total, 'earthquake')} of M${QUAKE_HISTORY_MIN_MAG}+ recorded by USGS within ${radiusKm} km since ${QUAKE_HISTORY_START.slice(0, 4)}`];
  parts.push(`(${fmt(q.strong)} of M6+, ${fmt(q.major)} of M7+)`);
  let basis = parts.join(' ') + '.';
  if (top?.magnitude != null) basis += ` Largest: M${top.magnitude.toFixed(1)} in ${year(top.time)}.`;
  if (q.latest?.time) basis += ` Most recent M${QUAKE_HISTORY_MIN_MAG}+: ${new Date(q.latest.time).toISOString().slice(0, 10)}.`;
  return {
    category: 'earthquakes',
    count: q.total,
    firstYear: null,
    lastYear: year(q.latest?.time ?? null),
    basis,
    notable: q.largest.map((e) => ({ id: `usgs:${e.id}`, title: e.title, time: e.time, distanceKm: Math.round(haversineKm(lat, lng, e.latitude, e.longitude)), magnitude: e.magnitude, url: e.url })),
  };
}

/** Long-term record of hazards near a point, for the safety planner. Every number comes from USGS or NASA EONET. */
export async function getSafetyHistory(lat: number, lng: number, radiusKm: number, opts: { fetchImpl?: FetchLike; now?: () => number } = {}): Promise<SafetyHistory> {
  const now = opts.now ?? Date.now;
  const f = opts.fetchImpl ?? fetch;
  const key = `${lat.toFixed(1)}:${lng.toFixed(1)}:${radiusKm}`;
  const hit = cache.get(key);
  if (hit && now() - hit.fetchedAt < FRESH_MS) return hit.value;

  const end = new Date(now()).toISOString().slice(0, 10);
  const [qRes, nRes] = await Promise.allSettled([quakeHistory(lat, lng, radiusKm, end, f), naturalHistory(lat, lng, radiusKm, end, f)]);
  const categories: HistoryCategory[] = [];
  const notes: string[] = [];

  let earthquakes: SafetyHistory['earthquakes'];
  if (qRes.status === 'fulfilled') {
    const q = qRes.value;
    earthquakes = { ok: true, since: QUAKE_HISTORY_START, minMagnitude: QUAKE_HISTORY_MIN_MAG, total: q.total, strong: q.strong, major: q.major };
    const c = quakeCategory(q, radiusKm, lat, lng);
    if (c) categories.push(c);
  } else {
    const reason = (qRes.reason as Error).message;
    log('warn', 'history_usgs_failed', { reason });
    earthquakes = { ok: false, error: `USGS ${reason}`, since: QUAKE_HISTORY_START, minMagnitude: QUAKE_HISTORY_MIN_MAG, total: 0, strong: 0, major: 0 };
    notes.push('USGS earthquake history could not be loaded, so past earthquakes are missing.');
  }

  let naturalEvents: SafetyHistory['naturalEvents'];
  if (nRes.status === 'fulfilled') {
    naturalEvents = { ok: true, since: EONET_HISTORY_START };
    const byCat = new Map<HazardCategory, { e: HazardEvent; d: number }[]>();
    for (const x of nRes.value.events) byCat.set(x.e.category, [...(byCat.get(x.e.category) ?? []), x]);
    for (const [category, list] of byCat) {
      const years = list.map((x) => year(x.e.startTime)).filter((y): y is number => y !== null);
      const first = years.length ? Math.min(...years) : null;
      const last = years.length ? Math.max(...years) : null;
      const recent = [...list].sort((a, b) => (b.e.startTime ?? 0) - (a.e.startTime ?? 0)).slice(0, NOTABLE_PER_CATEGORY);
      categories.push({
        category,
        count: list.length,
        firstYear: first,
        lastYear: last,
        basis: `${CATEGORIES[category].label}: ${plural(list.length, 'event')} recorded by NASA EONET within ${radiusKm} km${first !== null ? ` (${first === last ? first : `${first}–${last}`})` : ''}.`,
        notable: recent.map(({ e, d }): HistoryEvent => ({ id: e.id, title: e.title, time: e.startTime, distanceKm: Math.round(d), magnitude: null, url: e.sources.find((s) => s.url && s.origin)?.url ?? e.sources[0]?.url ?? null })),
      });
    }
    if (nRes.value.clipped) notes.push('The search area crosses the 180° meridian; natural events on the far side were not searched.');
  } else {
    const reason = (nRes.reason as Error).message;
    log('warn', 'history_eonet_failed', { reason });
    naturalEvents = { ok: false, error: `NASA EONET ${reason}`, since: EONET_HISTORY_START };
    notes.push('NASA EONET history could not be loaded, so past wildfires, storms, floods and volcanic events are missing.');
  }

  categories.sort((a, b) => (a.category === 'earthquakes' ? -1 : b.category === 'earthquakes' ? 1 : b.count - a.count));
  notes.push(
    `Earthquakes: USGS M${QUAKE_HISTORY_MIN_MAG}+ since ${QUAKE_HISTORY_START.slice(0, 4)}. Smaller or older earthquakes are not counted.`,
    `Other hazards: NASA EONET since ${EONET_HISTORY_START.slice(0, 4)}. EONET is a curated list, not a complete disaster record; its coverage varies by hazard type and year, and it does not record local floods, heatwaves or landslides comprehensively.`,
    'Past events show what has happened here, not what will happen. A short or empty record does not mean the area is safe.',
  );
  const value: SafetyHistory = { radiusKm, earthquakes, naturalEvents, categories, notes };
  if (qRes.status === 'fulfilled' && nRes.status === 'fulfilled') {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { value, fetchedAt: now() });
  }
  return value;
}
