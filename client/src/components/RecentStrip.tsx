import { ArrowRight } from 'lucide-react';
import { BAND_COLORS, magnitudeBand, type QuakeEvent } from '@shared/types';
import { formatUtc, shortPlace } from '../lib/format';

export default function RecentStrip({ events, onSelect }: { events: QuakeEvent[]; onSelect: (id: string) => void }) {
  const recent = [...events].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 4);
  if (recent.length === 0) return null;
  return (
    <section className="panel strip" aria-label="Most recent events">
      <h2>Most recent events</h2>
      <div className="strip-row">
        {recent.map((e) => (
          <button type="button" key={e.id} className="strip-card" onClick={() => onSelect(e.id)} style={{ borderTopColor: BAND_COLORS[magnitudeBand(e.magnitude)] }}>
            <b>{e.magnitude === null ? 'M ?' : `M ${e.magnitude.toFixed(1)}`} · {shortPlace(e.place, e.title)}</b>
            <small>{formatUtc(e.time)}</small>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
