import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PREFS, EMPTY_STATE, evaluate, type AppNotification, type CountryOf, type NotifyPrefs, type NotifyState } from '@shared/notify';
import type { HazardsResponse } from '@shared/types';

const KEYS = { prefs: 'impact.notify.prefs', state: 'impact.notify.state', items: 'impact.notify.items' };
const MAX_ITEMS = 50;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}
function loadItems(): AppNotification[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS.items) ?? '[]');
    return Array.isArray(v) ? v.slice(0, MAX_ITEMS) : [];
  } catch { return []; }
}
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

/** Evaluates each fresh 24-hour hazard response against the user's stored preferences. */
export function useNotifications(data: HazardsResponse | null, countryOf: CountryOf) {
  const [prefs, setPrefsState] = useState<NotifyPrefs>(() => load(KEYS.prefs, DEFAULT_PREFS));
  const [items, setItems] = useState<AppNotification[]>(loadItems);
  const state = useRef<NotifyState>(load(KEYS.state, EMPTY_STATE));
  const countryRef = useRef(countryOf);
  countryRef.current = countryOf;

  useEffect(() => {
    if (!data) return;
    const r = evaluate(data.events, prefs, state.current, Date.now(), countryRef.current);
    state.current = r.state;
    save(KEYS.state, r.state);
    if (r.notifications.length) {
      setItems((prev) => {
        const next = [...r.notifications, ...prev].slice(0, MAX_ITEMS);
        save(KEYS.items, next);
        return next;
      });
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- re-evaluate only on new data, not on preference edits

  const setPrefs = useCallback((p: NotifyPrefs) => { setPrefsState(p); save(KEYS.prefs, p); }, []);
  const update = (fn: (prev: AppNotification[]) => AppNotification[]) => setItems((prev) => { const next = fn(prev); save(KEYS.items, next); return next; });
  return {
    prefs, setPrefs, items,
    unread: items.filter((n) => !n.read).length,
    markRead: (id: string) => update((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n))),
    markAllRead: () => update((prev) => prev.map((n) => ({ ...n, read: true }))),
    clear: () => update(() => []),
  };
}
