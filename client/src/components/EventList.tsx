import { CATEGORIES, type HazardEvent } from '@shared/types';
import { HidePanel } from './PanelsMenu';
import { relativeTime } from '../lib/format';
import { CategoryIcon, hazardColor, hazardName, hazardSeverity, hazardTime } from '../lib/hazards';

interface Props { events: HazardEvent[]; selectedId: string | null; onSelect: (id: string) => void; loading: boolean; onHide: () => void }

const PAGE = 300;

export default function EventList({ events, selectedId, onSelect, loading, onHide }: Props) {
  const hide = <HidePanel label="Event list" onHide={onHide} />;
  if (loading && events.length === 0) return <div className="panel list" aria-busy="true"><div className="panel-head"><h2>Events</h2>{hide}</div>{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton row-skel" />)}</div>;
  if (events.length === 0) return <div className="panel list empty"><div className="panel-head"><h2>Events</h2>{hide}</div><p>No events match these filters.</p><p className="muted">Try another event type, a longer date range or a lower magnitude.</p></div>;
  return (
    <nav className="panel list" aria-label="Disaster events">
      <div className="panel-head"><h2>Events</h2>{hide}</div>
      <ul>
        {events.slice(0, PAGE).map((e) => {
          const color = hazardColor(e);
          const sev = hazardSeverity(e);
          return (
            <li key={e.id}>
              <button type="button" className={e.id === selectedId ? 'row sel' : 'row'} onClick={() => onSelect(e.id)} aria-current={e.id === selectedId ? 'true' : undefined}
                aria-label={`${CATEGORIES[e.category].label}: ${hazardName(e)}${sev ? `, ${sev}` : ''}, ${relativeTime(hazardTime(e))}`}>
                {e.category === 'earthquakes'
                  ? <span className="mag" style={{ color, borderColor: color }}>{e.severity ? e.severity.value.toFixed(1) : '–'}</span>
                  : <span className="mag cat" style={{ color, borderColor: color }}><CategoryIcon category={e.category} /></span>}
                <span className="row-text"><span>{hazardName(e)}</span><small>{CATEGORIES[e.category].label}{sev && e.category !== 'earthquakes' ? ` · ${sev}` : ''} · {relativeTime(hazardTime(e))}{e.sources.some((s) => s.provider === 'usgs') && e.sources.some((s) => s.provider === 'eonet') ? ' · USGS + NASA' : ''}</small></span>
              </button>
            </li>
          );
        })}
      </ul>
      {events.length > PAGE && <p className="muted small">Showing the first {PAGE} of {events.length}. Narrow the filters to see others.</p>}
    </nav>
  );
}
