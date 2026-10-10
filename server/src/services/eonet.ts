import { isHazardCategory, type HazardEvent, type HazardSource } from '../../../shared/types';
import { getConfig } from '../config';
import { log } from '../logger';

type FetchLike = typeof fetch;
const DAY_MS = 86_400_000;
export const EONET_WINDOW_DAYS = 30;
const MAX_TRACK = 20;
const CONCURRENCY = 3;
const CURRENT_FRESH_MS = 10 * 60_000;
const PAST_FRESH_MS = 6 * 60 * 60_000;
const WINDOW_CACHE_MAX = 40;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : null);
const time = (v: unknown): number | null => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const httpsUrl = (v: unknown): string | null => {
  const s = str(v, 600);
  if (!s) return null;
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
};
const validLngLat = (c: unknown): c is [number, number] =>
  Array.isArray(c) && num(c[0]) !== null && num(c[1]) !== null && Math.abs(c[0] as number) <= 180 && Math.abs(c[1] as number) <= 90;

/** One EONET geometry entry reduced to a point. Polygons use the mean of their outer ring. Unknown shapes are skipped. */
function geometryPoint(g: Record<string, unknown>): [number, number] | null {
  if (g.type === 'Point') return validLngLat(g.coordinates) ? [g.coordinates[0], g.coordinates[1]] : null;
  if (g.type === 'Polygon' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
    const ring = (g.coordinates[0] as unknown[]).filter(validLngLat);
    if (ring.length === 0) return null;
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }
  return null;
}

/** Convert one EONET v3 event into the shared model. Returns null when it has no usable category or position. */
export function normalizeEonetEvent(raw: unknown): HazardEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 60);
  const title = str(r.title, 200);
  const categoryId = Array.isArray(r.categories) ? (r.categories[0] as { id?: unknown } | undefined)?.id : undefined;
  if (!id || !title || !isHazardCategory(categoryId)) return null;

  const geoms = (Array.isArray(r.geometry) ? r.geometry : [])
    .filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === 'object')
    .map((g) => ({ g, point: geometryPoint(g), at: time(g.date) }))
    .filter((x): x is { g: Record<string, unknown>; point: [number, number]; at: number | null } => x.point !== null)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const latest = geoms[geoms.length - 1];
  if (!latest) return null;

  const withMag = [...geoms].reverse().find((x) => num(x.g.magnitudeValue) !== null && str(x.g.magnitudeUnit, 20));
  const sources: HazardSource[] = [];
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    const origin = str((s as { id?: unknown }).id, 30);
    const url = httpsUrl((s as { url?: unknown }).url);
    if (origin && url) sources.push({ provider: 'eonet', providerId: id, url, label: `NASA EONET, citing ${origin}`, origin });
  }
  const apiLink = httpsUrl(r.link);
  sources.push({ provider: 'eonet', providerId: id, url: apiLink, label: 'NASA EONET event record (JSON)' });

  const isPolygon = latest.g.type === 'Polygon';
  return {
    id: `eonet:${id}`,
    title,
    category: categoryId,
    longitude: latest.point[0],
    latitude: latest.point[1],
    geometryType: isPolygon ? 'polygon' : geoms.length > 1 ? 'track' : 'point',
    track: geoms.length > 1 ? geoms.slice(-MAX_TRACK).map((x) => [Math.round(x.point[0] * 1000) / 1000, Math.round(x.point[1] * 1000) / 1000]) : [],
    startTime: geoms[0]?.at ?? null,
    updatedTime: latest.at,
    closedTime: time(r.closed),
    severity: withMag ? { value: num(withMag.g.magnitudeValue)!, unit: str(withMag.g.magnitudeUnit, 20)!, provider: 'eonet' } : null,
    place: null,
    description: str(r.description, 600),
    sources,
    quake: null,
    match: null,
  };
}

export function normalizeEonetResponse(json: unknown): HazardEvent[] {
  const events = (json as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) throw new Error('Unexpected EONET response shape');
  return events.map(normalizeEonetEvent).filter((e): e is HazardEvent => e !== null);
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Split [start, end] into UTC day windows of at most EONET_WINDOW_DAYS, newest first. */
export function eonetWindows(start: number, end: number): { start: string; end: string; endMs: number }[] {
  const out: { start: string; end: string; endMs: number }[] = [];
  let we = Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate());
  const first = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate());
  while (we >= first) {
    const ws = Math.max(first, we - (EONET_WINDOW_DAYS - 1) * DAY_MS);
    out.push({ start: day(ws), end: day(we), endMs: we + DAY_MS - 1 });
    we = ws - DAY_MS;
  }
  return out;
}

interface WindowEntry { events: HazardEvent[]; fetchedAt: number }
const windowCache = new Map<string, WindowEntry>();
export const __resetEonetCache = () => windowCache.clear();

async function fetchWindow(w: { start: string; end: string; endMs: number }, opts: { force?: boolean; fetchImpl: FetchLike; now: () => number }): Promise<{ entry: WindowEntry; stale: boolean } | { error: string }> {
  const key = `${w.start}:${w.end}`;
  const cached = windowCache.get(key);
  const freshFor = w.endMs < opts.now() - DAY_MS ? PAST_FRESH_MS : CURRENT_FRESH_MS;
  if (cached && !opts.force && opts.now() - cached.fetchedAt < freshFor) return { entry: cached, stale: false };
  const url = `${getConfig().eonetBaseUrl}/events?status=all&start=${w.start}&end=${w.end}`;
  try {
    const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(45_000), headers: { Accept: 'application/json' } });
    if (res.status === 429) throw new Error('EONET rate limit reached');
    if (!res.ok) throw new Error(`EONET responded ${res.status}`);
    const entry = { events: normalizeEonetResponse(await res.json()), fetchedAt: opts.now() };
    if (windowCache.size >= WINDOW_CACHE_MAX) windowCache.delete(windowCache.keys().next().value as string);
    windowCache.set(key, entry);
    return { entry, stale: false };
  } catch (err) {
    log('warn', 'eonet_window_failed', { window: key, reason: (err as Error).message });
    if (cached) return { entry: cached, stale: true };
    return { error: (err as Error).message };
  }
}

export interface EonetResult { events: HazardEvent[]; fetchedAt: number | null; stale: boolean; failedWindows: number; windows: number }

/** All EONET events touching [start, end]. Windows are fetched a few at a time; one failing window does not sink the rest. */
export async function queryEonetRange(start: number, end: number, opts: { force?: boolean; fetchImpl?: FetchLike; now?: () => number } = {}): Promise<EonetResult> {
  const ctx = { force: opts.force, fetchImpl: opts.fetchImpl ?? fetch, now: opts.now ?? Date.now };
  const windows = eonetWindows(start, end);
  const results: Awaited<ReturnType<typeof fetchWindow>>[] = [];
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    results.push(...(await Promise.all(windows.slice(i, i + CONCURRENCY).map((w) => fetchWindow(w, ctx)))));
  }
  const byId = new Map<string, HazardEvent>();
  let fetchedAt: number | null = null;
  let stale = false;
  let failedWindows = 0;
  for (const r of results) {
    if ('error' in r) { failedWindows++; continue; }
    stale ||= r.stale;
    fetchedAt = fetchedAt === null ? r.entry.fetchedAt : Math.min(fetchedAt, r.entry.fetchedAt);
    for (const e of r.entry.events) {
      const prev = byId.get(e.id);
      // An event spanning windows appears in each; keep the most recently updated copy.
      if (!prev || (e.updatedTime ?? 0) > (prev.updatedTime ?? 0)) byId.set(e.id, e);
    }
  }
  if (failedWindows === windows.length) throw new Error('NASA EONET could not be reached for any part of this range.');
  return { events: [...byId.values()], fetchedAt, stale, failedWindows, windows: windows.length };
}
