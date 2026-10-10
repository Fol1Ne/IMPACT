import { BAND_COLORS, magnitudeBand, type QuakeEvent } from '@shared/types';
import { relativeTime, shortPlace } from '../lib/format';

interface Props { events: QuakeEvent[]; selectedId: string | null; onSelect: (id: string) => void; loading: boolean }

export default function EventList({ events, selectedId, onSelect, loading }: Props) {
  if (loading && events.length === 0) return <div className="panel list" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton row-skel" />)}</div>;
  if (events.length === 0) return <div className="panel list empty"><p>No events match these filters.</p><p className="muted">Try lowering the minimum magnitude or choosing a longer time window.</p></div>;
  return (
    <nav className="panel list" aria-label="Earthquake events">
      <ul>
        {events.slice(0, 300).map((e) => (
          <li key={e.id}>
            <button type="button" className={e.id === selectedId ? 'row sel' : 'row'} onClick={() => onSelect(e.id)} aria-current={e.id === selectedId ? 'true' : undefined}>
              <span className="mag" style={{ color: BAND_COLORS[magnitudeBand(e.magnitude)], borderColor: BAND_COLORS[magnitudeBand(e.magnitude)] }}>{e.magnitude === null ? '–' : e.magnitude.toFixed(1)}</span>
              <span className="row-text"><span>{shortPlace(e.place, e.title)}</span><small>{relativeTime(e.time)}</small></span>
            </button>
          </li>
        ))}
      </ul>
      {events.length > 300 && <p className="muted small">Showing the first 300 of {events.length}. Narrow the filters to see others.</p>}
    </nav>
  );
}
