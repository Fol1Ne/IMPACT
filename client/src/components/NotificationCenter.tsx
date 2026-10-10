import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Settings, X } from 'lucide-react';
import { CATEGORIES, type HazardCategory } from '@shared/types';
import type { AppNotification, NotifyPrefs } from '@shared/notify';
import type { Country } from '../lib/countries';
import { relativeTime } from '../lib/format';
import { CategoryIcon } from '../lib/hazards';
import type { LatLng } from './GlobeView';

interface Props {
  prefs: NotifyPrefs; onPrefs: (p: NotifyPrefs) => void;
  items: AppNotification[]; unread: number;
  onOpen: (n: AppNotification) => void; onMarkAllRead: () => void; onClear: () => void;
  country: Country | null; pin: LatLng | null;
  feedError: string | null;
}

const PREF_CATEGORIES: HazardCategory[] = ['earthquakes', 'volcanoes', 'severeStorms', 'floods', 'wildfires', 'landslides', 'seaLakeIce', 'drought', 'tempExtremes', 'dustHaze', 'conflict'];

export default function NotificationCenter(p: Props) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const set = (patch: Partial<NotifyPrefs>) => p.onPrefs({ ...p.prefs, ...patch });
  const toggleCat = (c: HazardCategory) => set({ categories: p.prefs.categories.includes(c) ? p.prefs.categories.filter((x) => x !== c) : [...p.prefs.categories, c] });
  const areaLabel = !p.prefs.area ? 'Anywhere' : p.prefs.area.kind === 'country' ? p.prefs.area.name : `${p.prefs.area.radiusKm} km around the planner pin`;

  return (
    <div className="notify" ref={root}>
      <button type="button" className="icon-btn notify-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        aria-label={p.prefs.enabled ? `Notifications, ${p.unread} unread` : 'Notifications are off'}>
        {p.prefs.enabled ? <Bell size={16} /> : <BellOff size={16} />}
        {p.unread > 0 && <span className="notify-count" aria-hidden="true">{p.unread > 9 ? '9+' : p.unread}</span>}
      </button>
      {open && (
        <div className="notify-pop panel" role="dialog" aria-label="Notifications">
          <header className="notify-head">
            <h2>Notifications</h2>
            <button type="button" className="icon-btn" aria-pressed={settings} aria-label="Notification preferences" onClick={() => setSettings(!settings)}><Settings size={14} /></button>
            <button type="button" className="icon-btn" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={14} /></button>
          </header>

          {settings || !p.prefs.enabled ? (
            <form className="notify-prefs" onSubmit={(e) => e.preventDefault()}>
              <label className="toggle"><input type="checkbox" checked={p.prefs.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Notify me in this tab about new events</label>
              <p className="muted small">Checks the last 24 hours every 5 minutes while IMPACT is open. Stored only in this browser. Not an official alerting service.</p>
              <fieldset className="field"><legend>Event types</legend>
                <div className="notify-cats">
                  {PREF_CATEGORIES.map((c) => (
                    <label key={c}><input type="checkbox" checked={p.prefs.categories.includes(c)} onChange={() => toggleCat(c)} /> <CategoryIcon category={c} size={12} /> {CATEGORIES[c].label}</label>
                  ))}
                </div>
              </fieldset>
              <label className="field"><span>Earthquakes from</span>
                <select value={p.prefs.minMagnitude} onChange={(e) => set({ minMagnitude: Number(e.target.value) })}>{[4.5, 5, 5.5, 6, 6.5, 7].map((m) => <option key={m} value={m}>M {m}+</option>)}</select>
              </label>
              <label className="field"><span>Area · {areaLabel}</span>
                <select value={!p.prefs.area ? 'any' : p.prefs.area.kind} onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'country' && p.country?.iso2) set({ area: { kind: 'country', iso2: p.country.iso2, name: p.country.name } });
                  else if (v === 'point' && p.pin) set({ area: { kind: 'point', latitude: p.pin.lat, longitude: p.pin.lng, radiusKm: 500 } });
                  else set({ area: null });
                }}>
                  <option value="any">Anywhere</option>
                  <option value="country" disabled={!p.country?.iso2 && p.prefs.area?.kind !== 'country'}>{p.country ? `Selected country (${p.country.name})` : p.prefs.area?.kind === 'country' ? p.prefs.area.name : 'Selected country (select one first)'}</option>
                  <option value="point" disabled={!p.pin && p.prefs.area?.kind !== 'point'}>{p.pin ? '500 km around the planner pin' : p.prefs.area?.kind === 'point' ? 'Saved planner pin' : 'Planner pin (drop one first)'}</option>
                </select>
              </label>
              <label className="field"><span>Group repeats for</span>
                <select value={p.prefs.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })}>{[0, 15, 30, 60, 180].map((m) => <option key={m} value={m}>{m === 0 ? 'No grouping' : `${m} minutes per type`}</option>)}</select>
              </label>
            </form>
          ) : (
            <>
              {p.feedError && <p className="notice warn small">Could not check for new events: {p.feedError}</p>}
              {p.items.length === 0 ? <p className="muted small">No notifications yet. New matching events will appear here; events that already existed when you turned this on are not repeated.</p> : (
                <ul className="notify-list">
                  {p.items.map((n) => (
                    <li key={n.id} className={n.read ? '' : 'unread'}>
                      <button type="button" onClick={() => { p.onOpen(n); setOpen(false); }}>
                        <span className="type-swatch" style={{ color: CATEGORIES[n.category].color }}><CategoryIcon category={n.category} size={14} /></span>
                        <span><b>{n.title}</b><small>{n.body} · {relativeTime(n.createdAt)}</small></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {p.items.length > 0 && <div className="notify-foot"><button type="button" className="text-btn" onClick={p.onMarkAllRead}>Mark all read</button><button type="button" className="text-btn" onClick={p.onClear}>Clear</button></div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
