import { Info, RefreshCw, Search } from 'lucide-react';
import type { EventsMeta } from '@shared/types';
import { relativeTime } from '../lib/format';

interface Props { meta: EventsMeta | null; loading: boolean; error: string | null; query: string; onQuery: (q: string) => void; onRefresh: () => void; onAbout: () => void }

export default function Header({ meta, loading, error, query, onQuery, onRefresh, onAbout }: Props) {
  let status = 'Connecting to USGS…';
  let tone = 'idle';
  if (meta) {
    if (meta.stale) { status = `Stale data · fetched ${relativeTime(meta.fetchedAt)}`; tone = 'warn'; }
    else { status = `Live USGS data · fetched ${relativeTime(meta.fetchedAt)}`; tone = 'ok'; }
  } else if (error) { status = 'USGS data unavailable'; tone = 'bad'; }
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="#22d3ee" strokeWidth="3.5" /><circle cx="16" cy="16" r="4.5" fill="#ef4444" /></svg>
        <div><h1>IMPACT</h1><p>Global disaster intelligence. Humanitarian action.</p></div>
      </div>
      <label className="search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search events by location</span>
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search by location or place name" />
      </label>
      <div className="top-actions">
        <div className={`status status-${tone}`} role="status"><span className="dot" aria-hidden="true" />{status}</div>
        <button type="button" className="icon-btn" onClick={onRefresh} disabled={loading} aria-label="Refresh earthquake data"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
        <button type="button" className="icon-btn" onClick={onAbout} aria-label="About IMPACT and data sources"><Info size={16} /></button>
      </div>
    </header>
  );
}
