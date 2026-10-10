import { ArrowRight } from 'lucide-react';
import { HidePanel } from './PanelsMenu';
import { CATEGORIES, type HazardEvent } from '@shared/types';
import { formatLocal } from '../lib/format';
import { CategoryIcon, hazardColor, hazardName, hazardSeverity, hazardTime } from '../lib/hazards';

export default function RecentStrip({ events, onSelect, onHide }: { events: HazardEvent[]; onSelect: (id: string) => void; onHide: () => void }) {
  const recent = [...events].sort((a, b) => (hazardTime(b) ?? 0) - (hazardTime(a) ?? 0)).slice(0, 4);
  if (recent.length === 0) return null;
  return (
    <section className="panel strip" aria-label="Most recently updated events">
      <div className="panel-head"><h2>Most recently updated</h2><HidePanel label="Recently updated" onHide={onHide} /></div>
      <div className="strip-row">
        {recent.map((e) => (
          <button type="button" key={e.id} className="strip-card" onClick={() => onSelect(e.id)} style={{ borderTopColor: hazardColor(e) }}>
            <b><CategoryIcon category={e.category} size={13} /> {hazardSeverity(e) ? `${hazardSeverity(e)} · ` : ''}{hazardName(e)}</b>
            <small>{CATEGORIES[e.category].label} · {formatLocal(hazardTime(e))}</small>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
