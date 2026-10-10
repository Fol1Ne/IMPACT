import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, HeartHandshake, Loader2, RefreshCw } from 'lucide-react';
import {
  CATEGORIES, PROVIDERS, filterHazards, minMagnitudeFloor, resolveRange, sortHazards,
  type HazardCategory, type HazardEvent, type HazardSort, type HealthResponse, type Provider,
} from '@shared/types';
import type { AppNotification } from '@shared/notify';
import { api, type RangeSelection } from './lib/api';
import { countryAt, countryMatcher, countryKey, loadCountryFeatures, toCountry, type Country } from './lib/countries';
import { formatLocal } from './lib/format';
import { CategoryIcon, hazardColor } from './lib/hazards';
import { useConflicts } from './hooks/useConflicts';
import { useHazards } from './hooks/useHazards';
import { useNotifications } from './hooks/useNotifications';
import AboutDialog from './components/AboutDialog';
import ConflictPanel from './components/ConflictPanel';
import CheckoutReturn from './components/CheckoutReturn';
import ErrorBoundary from './components/ErrorBoundary';
import EventDetail, { type Tab } from './components/EventDetail';
import EventList from './components/EventList';
import FilterPanel from './components/FilterPanel';
import HazardDetail from './components/HazardDetail';
import Header from './components/Header';
import NewsPanel from './components/NewsPanel';
import NotificationCenter from './components/NotificationCenter';
import { HiddenDock, HidePanel, PANELS, type PanelId } from './components/PanelsMenu';
import RecentStrip from './components/RecentStrip';
import SafetyPanel from './components/SafetyPanel';
import type { LatLng } from './components/GlobeView';
import type { DonateReturn } from './components/DonateDialog';

const GlobeView = lazy(() => import('./components/GlobeView'));
const DonateDialog = lazy(() => import('./components/DonateDialog'));
const ALL_PANELS = new Set(Object.keys(PANELS) as PanelId[]);

const TABS: Tab[] = ['overview', 'briefing', 'resources', 'preparedness'];
type SideTab = 'news' | 'event' | 'conflict' | 'safety';
const PANELS_KEY = 'impact.panels.hidden';
const loadHidden = (): Set<PanelId> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is PanelId => typeof x === 'string' && x in PANELS) : []);
  } catch { return new Set(); }
};
const ALL_CATEGORIES = Object.keys(CATEGORIES) as HazardCategory[];
const ALL_PROVIDERS = Object.keys(PROVIDERS) as Provider[];
const LEGEND: HazardCategory[] = ['wildfires', 'severeStorms', 'volcanoes', 'floods'];
/** Older links used bare USGS ids (`?event=us7000abcd`). */
const normaliseEventParam = (v: string | null) => (!v ? null : v.includes(':') ? v : `usgs:${v}`);
const NOTIFY_RANGE: RangeSelection = { preset: '24h' };

export default function App() {
  const path = window.location.pathname;
  if (path === '/checkout/success') return <CheckoutReturn kind="success" />;
  if (path === '/checkout/cancel') return <CheckoutReturn kind="cancel" />;
  return <Explorer />;
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v); else next.add(v);
  return next;
}

function Explorer() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [range, setRange] = useState<RangeSelection>({ preset: '7d' });
  const [categories, setCategories] = useState<Set<HazardCategory>>(() => new Set(ALL_CATEGORIES));
  const [sources, setSources] = useState<Set<Provider>>(() => new Set(ALL_PROVIDERS));
  const [minMag, setMinMag] = useState(0);
  const [sort, setSort] = useState<HazardSort>('time');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(normaliseEventParam(params.get('event')));
  const [about, setAbout] = useState(false);
  const [donate, setDonate] = useState<null | { returned: DonateReturn }>(() => {
    const d = params.get('donation');
    const sid = params.get('session_id');
    if (d === 'done' && sid && /^cs_test_[A-Za-z0-9]+$/.test(sid)) return { returned: { kind: 'done', sessionId: sid } };
    if (d === 'cancelled') return { returned: { kind: 'cancelled' } };
    return null;
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const { data, loading, error, refresh } = useHazards(range);
  const notifyFeed = useHazards(NOTIFY_RANGE);
  const conflicts = useConflicts();
  const initialTab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const [sideTab, setSideTab] = useState<SideTab>(params.get('event') ? 'event' : 'news');
  const [country, setCountry] = useState<Country | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [hidden, setHidden] = useState<Set<PanelId>>(loadHidden);
  const [focus, setFocus] = useState<{ lat: number; lng: number; altitude: number; tick: number } | null>(null);
  const countryFeatures = useMemo(() => { try { return loadCountryFeatures(); } catch { return []; } }, []);
  const countryOptions = useMemo(() => countryFeatures.filter((f) => !f.properties.occupied).map((f) => toCountry(f.properties)), [countryFeatures]);
  const countryOf = useCallback((lat: number, lng: number) => countryAt(countryFeatures, lat, lng)?.properties.iso2 ?? null, [countryFeatures]);
  const regionOf = useCallback((p: LatLng) => {
    const f = countryAt(countryFeatures, p.lat, p.lng);
    return f ? (f.properties.occupied && f.properties.territoryName ? f.properties.territoryName : f.properties.name) : null;
  }, [countryFeatures]);
  const notify = useNotifications(notifyFeed.data, countryOf);

  useEffect(() => { try { localStorage.setItem(PANELS_KEY, JSON.stringify([...hidden])); } catch { /* storage unavailable */ } }, [hidden]);
  const hidePanel = (id: PanelId) => setHidden((h) => { const n = new Set(h); n.add(id); return n; });
  const showPanel = (id: PanelId) => setHidden((h) => { if (!h.has(id)) return h; const n = new Set(h); n.delete(id); return n; });
  const showSide = () => showPanel('side');
  useEffect(() => { api.health().then(setHealth).catch((e: Error) => setHealthError(e.message)); }, []);
  useEffect(() => {
    if (!params.has('donation')) return;
    const url = new URL(window.location.href);
    for (const k of ['donation', 'session_id']) url.searchParams.delete(k);
    window.history.replaceState(null, '', url);
  }, [params]);

  const selectEvent = (id: string | null) => { setSelectedId(id); setPickMode(false); setSideTab(id ? 'event' : 'news'); if (id) showSide(); };
  const selectCountry = (c: Country | null) => { setCountry(c); setSideTab('news'); if (c) showSide(); };
  const openSafety = () => { setSideTab('safety'); if (!pin) setPickMode(true); };
  const placePin = (p: LatLng | null) => {
    setPin(p);
    if (p) { setPickMode(false); setFocus({ lat: p.lat, lng: p.lng, altitude: 1.6, tick: Date.now() }); }
  };

  const all = data?.events ?? [];
  const known = useMemo(() => {
    const m = new Map<string, HazardEvent>();
    for (const e of notifyFeed.data?.events ?? []) m.set(e.id, e);
    for (const e of all) m.set(e.id, e);
    return m;
  }, [all, notifyFeed.data]);
  const bySource = useMemo(() => filterHazards(all, { providers: [...sources], minMagnitude: minMag, query }), [all, sources, minMag, query]);
  const counts = useMemo(() => {
    const c: Partial<Record<HazardCategory, number>> = {};
    for (const e of bySource) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [bySource]);
  const visible = useMemo(() => sortHazards(bySource.filter((e) => categories.has(e.category)), sort), [bySource, categories, sort]);
  const selected = selectedId ? known.get(selectedId) ?? null : null;
  const globeEvents = useMemo(() => (selected && !visible.includes(selected) ? [...visible, selected] : visible), [visible, selected]);
  const countryEvents = useMemo(() => {
    if (!country) return [];
    const inside = countryMatcher(countryFeatures, countryKey(country));
    return visible.filter((e) => inside(e.latitude, e.longitude));
  }, [country, countryFeatures, visible]);
  const conflictCountries = useMemo(() => {
    const listed = conflicts.data?.countries ?? [];
    return listed.map((c) => {
      const f = countryFeatures.find((x) => x.properties.iso2 === c.iso2 && !x.properties.occupied);
      return f ? { ...c, latitude: f.properties.latitude, longitude: f.properties.longitude, altitude: f.properties.altitude } : c;
    });
  }, [conflicts.data, countryFeatures]);
  const conflictIso2 = useMemo(() => new Set(conflictCountries.map((c) => c.iso2)), [conflictCountries]);
  const magFloor = data?.meta.minMagnitude ?? minMagnitudeFloor(resolveRange('preset' in range ? { preset: range.preset } : range));
  const openConflictCountry = (iso2: string) => {
    const c = conflictCountries.find((x) => x.iso2 === iso2);
    const f = countryFeatures.find((x) => x.properties.iso2 === iso2 && !x.properties.occupied);
    if (f) selectCountry(toCountry(f.properties));
    else if (c) setFocus({ lat: c.latitude, lng: c.longitude, altitude: c.altitude || 1.2, tick: Date.now() });
    showSide();
    setSideTab('news');
  };

  const openNotification = (n: AppNotification) => {
    notify.markRead(n.id);
    if (!n.eventId) return;
    const e = known.get(n.eventId);
    selectEvent(n.eventId);
    if (e) setFocus({ lat: e.latitude, lng: e.longitude, altitude: 1.4, tick: Date.now() });
  };

  const failedProviders = data?.meta.providers.filter((p) => !p.ok) ?? [];
  const staleProviders = data?.meta.providers.filter((p) => p.ok && (p.stale || p.partial)) ?? [];
  const sideLabel = selected ? (selected.category === 'earthquakes' ? `Earthquake · M${selected.quake?.magnitude?.toFixed(1) ?? '?'}` : CATEGORIES[selected.category].label) : 'Event';

  // The donation popup takes over the screen; the saved layout returns when it closes.
  const view = donate ? ALL_PANELS : hidden;
  return (
    <div className={['app', view.has('filters') && view.has('list') ? 'hide-left' : '', view.has('side') ? 'hide-right' : ''].filter(Boolean).join(' ')}>
      <Header meta={data?.meta ?? null} loading={loading} error={error} query={query} onQuery={setQuery} onRefresh={refresh} onAbout={() => setAbout(true)}
        actions={<>
          <NotificationCenter prefs={notify.prefs} onPrefs={notify.setPrefs} items={notify.items} unread={notify.unread} onOpen={openNotification}
            onMarkAllRead={notify.markAllRead} onClear={notify.clear} country={country} pin={pin} feedError={notifyFeed.error} />
          <button type="button" className="btn donate-btn" onClick={() => setDonate({ returned: null })} aria-haspopup="dialog"><HeartHandshake size={14} aria-hidden="true" /> Donate (test)</button>
        </>}
      />
      {failedProviders.map((p) => <div key={p.provider} className="banner warn" role="alert"><AlertTriangle size={16} aria-hidden="true" /> {PROVIDERS[p.provider].label} could not be reached ({p.error}). Its events are missing from this view.</div>)}
      {staleProviders.map((p) => <div key={p.provider} className="banner warn" role="status"><AlertTriangle size={16} aria-hidden="true" /> {PROVIDERS[p.provider].label} data is {p.stale ? `stale (last fetched ${formatLocal(p.fetchedAt)})` : 'incomplete for this period'}. {p.notes.join(' ')}</div>)}
      {error && data && <div className="banner warn" role="alert"><AlertTriangle size={16} aria-hidden="true" /> Could not refresh: {error} Showing previously retrieved data.</div>}

      <main className="layout">
        <div className="col-left">
          {!view.has('filters') && <FilterPanel range={range} onRange={(r) => { setRange(r); setMinMag(0); }} categories={categories} onToggleCategory={(c) => setCategories((s) => toggle(s, c))} counts={counts}
            sources={sources} onToggleSource={(p) => setSources((s) => toggle(s, p))} minMag={minMag} onMinMag={setMinMag} magFloor={magFloor}
            sort={sort} onSort={setSort} total={all.length} shown={visible.length} conflictCount={conflictCountries.length} onHide={() => hidePanel('filters')} />}
          {!view.has('list') && <EventList events={visible} selectedId={selectedId} onSelect={selectEvent} loading={loading} onHide={() => hidePanel('list')} />}
        </div>

        <div className="col-center">
          <section className="globe-panel" aria-label="Interactive globe of disaster events">
            {error && !data ? (
              <div className="state-card" role="alert"><AlertTriangle size={28} aria-hidden="true" /><h2>Event data unavailable</h2><p>{error}</p><button type="button" className="btn primary" onClick={refresh}><RefreshCw size={14} aria-hidden="true" /> Try again</button></div>
            ) : (
              <ErrorBoundary fallback={<div className="state-card" role="alert"><AlertTriangle size={28} aria-hidden="true" /><h2>The 3D globe could not start</h2><p>Your browser may not support WebGL. The event list on the left still works.</p></div>}>
                <Suspense fallback={<div className="state-card"><Loader2 className="spin" aria-hidden="true" /><p>Loading globe…</p></div>}>
                  <GlobeView events={globeEvents} selectedId={selectedId} onSelect={selectEvent} countries={countryFeatures} selectedCountry={country} onSelectCountry={selectCountry}
                    conflictIso2={conflictIso2} showConflict={categories.has('conflict')}
                    pickMode={pickMode} pin={pin} onPick={(c) => placePin({ lat: c.lat, lng: c.lng })} focus={focus} />
                </Suspense>
              </ErrorBoundary>
            )}
            {loading && <div className="loading-chip" role="status"><Loader2 size={14} className="spin" aria-hidden="true" /> {data ? 'Updating…' : 'Loading USGS and NASA EONET events…'}{'preset' in range && ['90d', '365d'].includes(range.preset) || !('preset' in range) ? ' Long ranges can take up to a minute the first time.' : ''}</div>}
            {pickMode && <div className="pick-chip" role="status">Click anywhere on the globe to place the safety-planner pin. <button type="button" className="text-btn" onClick={() => setPickMode(false)}>Cancel</button></div>}
          </section>
          <div className="center-spacer" aria-hidden="true" />
          {!view.has('legend') && <div className="legend" aria-label="Marker colour legend">
              <HidePanel label="Legend" onHide={() => hidePanel('legend')} />
              <span><i style={{ background: hazardColor({ category: 'earthquakes', severity: { value: 4, unit: 'M', provider: 'usgs' } } as HazardEvent) }} /> quake &lt;M4.5</span>
              <span><i style={{ background: hazardColor({ category: 'earthquakes', severity: { value: 5, unit: 'M', provider: 'usgs' } } as HazardEvent) }} /> M4.5–5.9</span>
              <span><i style={{ background: hazardColor({ category: 'earthquakes', severity: { value: 6.5, unit: 'M', provider: 'usgs' } } as HazardEvent) }} /> M6+</span>
              {LEGEND.map((c) => <span key={c}><i style={{ background: CATEGORIES[c].color }} /> <CategoryIcon category={c} size={11} /> {CATEGORIES[c].label}</span>)}
              {categories.has('conflict') && conflictCountries.length > 0 && <span><i style={{ background: CATEGORIES.conflict.color }} /> <CategoryIcon category="conflict" size={11} /> {CATEGORIES.conflict.label}</span>}
          </div>}
          {!view.has('strip') && <RecentStrip events={visible} onSelect={selectEvent} onHide={() => hidePanel('strip')} />}
        </div>

        {!view.has('side') && <div className="col-right">
          <div role="tablist" aria-label="Side panel" className="side-tabs">
            <button type="button" role="tab" id="side-tab-news" aria-selected={sideTab === 'news'} aria-controls="side-pane" className={sideTab === 'news' ? 'on' : ''} onClick={() => setSideTab('news')}>News{country ? ` · ${country.name}` : ''}</button>
            <button type="button" role="tab" id="side-tab-event" aria-selected={sideTab === 'event'} aria-controls="side-pane" className={sideTab === 'event' ? 'on' : ''} onClick={() => setSideTab('event')}>{sideLabel}</button>
            <button type="button" role="tab" id="side-tab-conflict" aria-selected={sideTab === 'conflict'} aria-controls="side-pane" className={sideTab === 'conflict' ? 'on' : ''} onClick={() => setSideTab('conflict')}>Conflict</button>
            <button type="button" role="tab" id="side-tab-safety" aria-selected={sideTab === 'safety'} aria-controls="side-pane" className={sideTab === 'safety' ? 'on' : ''} onClick={openSafety}>Safety</button>
            <HidePanel label="Side panel" onHide={() => hidePanel('side')} />
          </div>
          <div id="side-pane" role="tabpanel" aria-labelledby={`side-tab-${sideTab}`} className="side-pane">
          {sideTab === 'news' ? (
            <aside className="panel" aria-label="News"><NewsPanel country={country} countries={countryOptions} onSelectCountry={selectCountry} countryEvents={countryEvents} onSelectEvent={selectEvent} /></aside>
          ) : sideTab === 'conflict' ? (
            <ConflictPanel countries={conflictCountries} sourceUrl={conflicts.data?.meta.sourceUrl ?? 'https://en.wikipedia.org/wiki/List_of_ongoing_armed_conflicts'}
              pageTitle={conflicts.data?.meta.pageTitle ?? 'List of ongoing armed conflicts'} fetchedAt={conflicts.data?.meta.fetchedAt ?? null}
              stale={conflicts.data?.meta.stale ?? false} notes={conflicts.data?.meta.notes ?? []} error={conflicts.error} categoryOn={categories.has('conflict')}
              onOpenCountry={openConflictCountry} />
          ) : sideTab === 'safety' ? (
            <SafetyPanel pin={pin} onPin={placePin} pickMode={pickMode} onPickMode={setPickMode} regionOf={regionOf}
              iso2Of={(p) => countryOf(p.lat, p.lng)} smsConfigured={health?.twilio.configured ?? null} onSelectEvent={selectEvent} />
          ) : selected?.quake ? (
            <EventDetail key={selected.id} event={selected.quake} hazard={selected} health={health} healthError={healthError} initialTab={initialTab} onClose={() => selectEvent(null)} />
          ) : selected ? (
            <HazardDetail key={selected.id} event={selected} onClose={() => selectEvent(null)} />
          ) : (
            <aside className="panel intro" aria-label="About this view">
              <h2>Discover, understand, act</h2>
              <p>{selectedId && loading ? 'Loading the linked event…' : selectedId ? 'The linked event is not in the selected date range. Widen the range to find it.' : 'Select an event on the globe or in the list to see what the sources confirm, what they do not, and where to find trustworthy help.'}</p>
              <ol>
                <li><b>Discover</b> earthquakes (USGS), wildfires, storms, volcanoes and floods (NASA EONET) and reported armed conflict (Conflict tab). Click a country for its news.</li>
                <li><b>Understand</b> earthquakes with a grounded AI briefing.</li>
                <li><b>Plan</b> with the Safety tab: drop a pin to see nearby hazards, including reported fighting.</li>
                <li><b>Act</b> with official resources, the preparedness package, or a test-mode donation.</li>
              </ol>
              <p className="notice info">IMPACT is an independent information platform, not an official emergency service.</p>
            </aside>
          )}
          </div>
        </div>}
      </main>
      {!donate && <HiddenDock hidden={hidden} onShow={showPanel} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {donate && <Suspense fallback={null}><DonateDialog returned={donate.returned} onClose={() => setDonate(null)} /></Suspense>}
    </div>
  );
}
