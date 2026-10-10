import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { BAND_COLORS, DEFAULT_FEED, FEEDS, filterEvents, sortEvents, type FeedId, type HealthResponse, type SortKey } from '@shared/types';
import { api } from './lib/api';
import { formatUtc } from './lib/format';
import { useEvents } from './hooks/useEvents';
import AboutDialog from './components/AboutDialog';
import CheckoutReturn from './components/CheckoutReturn';
import ErrorBoundary from './components/ErrorBoundary';
import EventDetail, { type Tab } from './components/EventDetail';
import EventList from './components/EventList';
import FilterPanel from './components/FilterPanel';
import Header from './components/Header';
import RecentStrip from './components/RecentStrip';

const GlobeView = lazy(() => import('./components/GlobeView'));

const TABS: Tab[] = ['overview', 'briefing', 'resources', 'preparedness'];

export default function App() {
  const path = window.location.pathname;
  if (path === '/checkout/success') return <CheckoutReturn kind="success" />;
  if (path === '/checkout/cancel') return <CheckoutReturn kind="cancel" />;
  return <Explorer />;
}

function Explorer() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [feed, setFeed] = useState<FeedId>(DEFAULT_FEED);
  const [minMag, setMinMag] = useState(0);
  const [sort, setSort] = useState<SortKey>('time');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('event'));
  const [about, setAbout] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const { data, loading, error, refresh } = useEvents(feed);
  const initialTab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';

  useEffect(() => { api.health().then(setHealth).catch((e: Error) => setHealthError(e.message)); }, []);

  const all = data?.events ?? [];
  const visible = useMemo(() => sortEvents(filterEvents(all, { minMagnitude: minMag, query }), sort), [all, minMag, query, sort]);
  const selected = useMemo(() => all.find((e) => e.id === selectedId) ?? null, [all, selectedId]);
  const globeEvents = useMemo(() => (selected && !visible.includes(selected) ? [...visible, selected] : visible), [visible, selected]);

  return (
    <div className="app">
      <Header meta={data?.meta ?? null} loading={loading} error={error} query={query} onQuery={setQuery} onRefresh={refresh} onAbout={() => setAbout(true)} />
      {data?.meta.stale && <div className="banner warn" role="alert"><AlertTriangle size={16} aria-hidden="true" /> {data.meta.staleReason} Data last fetched {formatUtc(data.meta.fetchedAt)}.</div>}
      {error && data && !data.meta.stale && <div className="banner warn" role="alert"><AlertTriangle size={16} aria-hidden="true" /> Could not refresh: {error} Showing previously retrieved data.</div>}

      <main className="layout">
        <div className="col-left">
          <FilterPanel feed={feed} onFeed={setFeed} minMag={minMag} onMinMag={setMinMag} sort={sort} onSort={setSort} total={all.length} shown={visible.length} />
          <EventList events={visible} selectedId={selectedId} onSelect={setSelectedId} loading={loading} />
        </div>

        <div className="col-center">
          <section className="globe-panel" aria-label="Interactive globe of earthquakes">
            {error && !data ? (
              <div className="state-card" role="alert"><AlertTriangle size={28} aria-hidden="true" /><h2>Earthquake data unavailable</h2><p>{error}</p><button type="button" className="btn primary" onClick={refresh}><RefreshCw size={14} aria-hidden="true" /> Try again</button></div>
            ) : (
              <ErrorBoundary fallback={<div className="state-card" role="alert"><AlertTriangle size={28} aria-hidden="true" /><h2>The 3D globe could not start</h2><p>Your browser may not support WebGL. The event list on the left still works.</p></div>}>
                <Suspense fallback={<div className="state-card"><Loader2 className="spin" aria-hidden="true" /><p>Loading globe…</p></div>}>
                  <GlobeView events={globeEvents} selectedId={selectedId} onSelect={setSelectedId} />
                </Suspense>
              </ErrorBoundary>
            )}
            {loading && !data && !error && <div className="loading-chip" role="status"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading USGS earthquakes…</div>}
            <div className="stat-chip"><b>{visible.length}</b><span>earthquakes shown</span><small>{data ? data.meta.coverage : 'waiting for data'}</small></div>
            <div className="legend" aria-label="Marker colour legend">
              <span><i style={{ background: BAND_COLORS['under-4.5'] }} /> under M4.5</span><span><i style={{ background: BAND_COLORS['4.5-5.9'] }} /> M4.5 to 5.9</span><span><i style={{ background: BAND_COLORS['6-plus'] }} /> M6 and above</span>
            </div>
          </section>
          <RecentStrip events={all} onSelect={setSelectedId} />
        </div>

        <div className="col-right">
          {selected ? (
            <EventDetail event={selected} health={health} healthError={healthError} initialTab={initialTab} onClose={() => setSelectedId(null)} />
          ) : (
            <aside className="panel intro" aria-label="About this view">
              <h2>Discover, understand, act</h2>
              <p>Select an earthquake on the globe or in the list to see what the data confirms, what it does not, and where to find trustworthy help and information.</p>
              <ol>
                <li><b>Discover</b> real USGS earthquake events.</li>
                <li><b>Understand</b> them with a grounded AI briefing.</li>
                <li><b>Find resources</b> from official organisations.</li>
                <li><b>Take action</b> by preparing with the sandbox preparedness package.</li>
              </ol>
              {data && <p className="muted small">Dataset: {FEEDS[data.meta.feed].coverage}. Last fetched {formatUtc(data.meta.fetchedAt)}.</p>}
              <p className="notice info">IMPACT is an independent information platform, not an official emergency service.</p>
            </aside>
          )}
        </div>
      </main>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </div>
  );
}
