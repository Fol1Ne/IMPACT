import type { ReactNode } from 'react';
import { Info, RefreshCw, Search } from 'lucide-react';
import { PROVIDERS, type HazardsResponse } from '@shared/types';
import { relativeTime } from '../lib/format';

interface Props {
  meta: HazardsResponse['meta'] | null; loading: boolean; error: string | null;
  query: string; onQuery: (q: string) => void; onRefresh: () => void; onAbout: () => void;
  actions?: ReactNode;
}

export default function Header({ meta, loading, error, query, onQuery, onRefresh, onAbout, actions }: Props) {
  let status = 'Connecting to event sources…';
  let tone = 'idle';
  if (meta) {
    const ok = meta.providers.filter((p) => p.ok);
    const oldest = Math.min(...ok.map((p) => p.fetchedAt ?? Date.now()));
    const names = ok.map((p) => PROVIDERS[p.provider].label).join(' + ');
    const degraded = meta.providers.some((p) => !p.ok || p.stale || p.partial);
    status = `${degraded ? 'Partial data' : 'Live data'} · ${names} · fetched ${relativeTime(oldest)}`;
    tone = degraded ? 'warn' : 'ok';
  } else if (error) { status = 'Event data unavailable'; tone = 'bad'; }
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="#22d3ee" strokeWidth="3.5" /><circle cx="16" cy="16" r="4.5" fill="#ef4444" /></svg>
        <div><h1>IMPACT</h1><p>Global disaster intelligence. Humanitarian action.</p></div>
      </div>
      <label className="search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search events by name or place</span>
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search events by name or place" />
      </label>
      <div className="top-actions">
        <div className={`status status-${tone}`} role="status"><span className="dot" aria-hidden="true" />{status}</div>
        <button type="button" className="icon-btn" onClick={onRefresh} disabled={loading} aria-label="Refresh event data"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
        {actions}
        <button type="button" className="icon-btn" onClick={onAbout} aria-label="About IMPACT and data sources"><Info size={16} /></button>
      </div>
    </header>
  );
}
