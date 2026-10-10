import { haversineKm, type HazardCategory, type HazardEvent } from './types';

export interface NotifyPrefs {
  enabled: boolean;
  categories: HazardCategory[];
  /** Earthquakes below this magnitude are ignored. */
  minMagnitude: number;
  /** Optional watch area; null means anywhere. */
  area: { kind: 'country'; iso2: string; name: string } | { kind: 'point'; latitude: number; longitude: number; radiusKm: number } | null;
  /** Per-category quiet period after a notification, in minutes. */
  cooldownMinutes: number;
}

export const DEFAULT_PREFS: NotifyPrefs = {
  enabled: false,
  categories: ['earthquakes', 'volcanoes', 'severeStorms', 'floods', 'wildfires'],
  minMagnitude: 6,
  area: null,
  cooldownMinutes: 30,
};

export interface NotifyState {
  /** Event ids already considered. Bounded. */
  seen: string[];
  /** category -> last notification time (ms). */
  lastByCategory: Partial<Record<HazardCategory, number>>;
  /** False until the first poll has set a baseline. */
  primed: boolean;
}
export const EMPTY_STATE: NotifyState = { seen: [], lastByCategory: {}, primed: false };
export const MAX_SEEN = 3000;

export interface AppNotification {
  id: string;
  eventId: string | null;
  category: HazardCategory;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}

/** Country lookup is injected so this module stays free of geometry data. */
export type CountryOf = (lat: number, lng: number) => string | null;

export function matchesPrefs(e: HazardEvent, p: NotifyPrefs, countryOf: CountryOf): boolean {
  if (!p.categories.includes(e.category)) return false;
  if (e.category === 'earthquakes' && (e.quake?.magnitude ?? -Infinity) < p.minMagnitude) return false;
  if (p.area?.kind === 'country' && countryOf(e.latitude, e.longitude) !== p.area.iso2) return false;
  if (p.area?.kind === 'point' && haversineKm(p.area.latitude, p.area.longitude, e.latitude, e.longitude) > p.area.radiusKm) return false;
  return true;
}

/**
 * Turn a fresh event list into notifications.
 * - The first run only records a baseline, so opening the app never floods the user.
 * - Each event id notifies at most once.
 * - Within a category's cooldown, further matches are folded into one summary.
 */
export function evaluate(events: HazardEvent[], prefs: NotifyPrefs, state: NotifyState, now: number, countryOf: CountryOf): { state: NotifyState; notifications: AppNotification[] } {
  const seen = new Set(state.seen);
  const fresh = events.filter((e) => !seen.has(e.id));
  const nextSeen = [...state.seen, ...fresh.map((e) => e.id)].slice(-MAX_SEEN);
  if (!state.primed || !prefs.enabled) return { state: { ...state, seen: nextSeen, primed: true }, notifications: [] };

  const byCat = new Map<HazardCategory, HazardEvent[]>();
  for (const e of fresh) {
    if (!matchesPrefs(e, prefs, countryOf)) continue;
    byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
  }
  const lastByCategory = { ...state.lastByCategory };
  const out: AppNotification[] = [];
  const cooldown = prefs.cooldownMinutes * 60_000;
  for (const [category, list] of [...byCat].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => (b.quake?.magnitude ?? 0) - (a.quake?.magnitude ?? 0) || (b.startTime ?? 0) - (a.startTime ?? 0));
    const last = lastByCategory[category];
    const cooling = last !== undefined && now - last < cooldown;
    const top = list[0]!;
    if (!cooling && list.length === 1) {
      out.push({ id: `n:${top.id}:${now}`, eventId: top.id, category, title: top.title, body: top.place ?? 'New event record', createdAt: now, read: false });
    } else {
      out.push({
        id: `n:${category}:${now}`, eventId: top.id, category,
        title: `${list.length} new ${list.length === 1 ? 'event' : 'events'}: ${top.title}${list.length > 1 ? ' and more' : ''}`,
        body: cooling ? 'Grouped because of your notification cooldown.' : 'Several new matching events arrived together.',
        createdAt: now, read: false,
      });
    }
    lastByCategory[category] = now;
  }
  return { state: { seen: nextSeen, lastByCategory, primed: true }, notifications: out };
}
