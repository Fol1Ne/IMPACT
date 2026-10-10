import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ExternalLink, MapPin, Sparkles, X, Clock, Activity, ChevronRight } from 'lucide-react';
import { BAND_COLORS, depthClass, magnitudeBand, magnitudeClass, type HazardEvent, type HealthResponse, type QuakeEvent } from '@shared/types';
import { formatCoords, formatLocal } from '../lib/format';
import BriefingPanel from './BriefingPanel';
import { SourceRecords } from './HazardDetail';
import PreparednessPanel from './PreparednessPanel';
import ResourcesPanel from './ResourcesPanel';

export type Tab = 'overview' | 'briefing' | 'resources' | 'preparedness';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'briefing', label: 'Briefing' },
  { id: 'resources', label: 'Resources' }, { id: 'preparedness', label: 'Preparedness' },
];

interface Props { event: QuakeEvent; hazard?: HazardEvent; health: HealthResponse | null; healthError: string | null; initialTab?: Tab; onClose: () => void }

export default function EventDetail({ event, hazard, health, healthError, initialTab = 'overview', onClose }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setTab('overview'); }, [event.id]);
  const color = BAND_COLORS[magnitudeBand(event.magnitude)];
  const dc = depthClass(event.depthKm);

  return (
    <aside className="panel detail" aria-label="Selected event details">
      <header className="detail-head">
        <span className="badge" style={{ background: `${color}22`, borderColor: color }}><span style={{ background: color }} /></span>
        <div><small>Earthquake</small><h2>{event.place ?? event.title}</h2></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close event details"><X size={16} /></button>
      </header>

      <dl className="stats">
        <div><dt><Activity size={14} aria-hidden="true" /> Magnitude</dt><dd>{event.magnitude === null ? 'n/a' : event.magnitude.toFixed(1)}<small>{magnitudeClass(event.magnitude)}</small></dd></div>
        <div><dt><ArrowDown size={14} aria-hidden="true" /> Depth</dt><dd>{event.depthKm === null ? 'n/a' : `${event.depthKm.toFixed(0)} km`}<small>{dc ?? 'not reported'}</small></dd></div>
        <div><dt><Clock size={14} aria-hidden="true" /> Time</dt><dd className="time">{formatLocal(event.time)}</dd></div>
      </dl>
      <p className="loc"><MapPin size={14} aria-hidden="true" /> <span className="mono">{formatCoords(event.latitude, event.longitude)}</span></p>
      <p className="src">Source: {event.url
        ? <a href={event.url} target="_blank" rel="noopener noreferrer">USGS event page <ExternalLink size={12} aria-hidden="true" /></a>
        : 'USGS Earthquake Hazards Program (no event page URL provided)'}</p>

      <button type="button" className="cta" onClick={() => setTab('briefing')}>
        <Sparkles size={18} aria-hidden="true" /><span><b>AI briefing</b><small>A plain-language summary grounded in the USGS record</small></span><ChevronRight size={16} aria-hidden="true" />
      </button>

      <div role="tablist" aria-label="Event sections" className="tabs">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`pane-${t.id}`} onClick={() => setTab(t.id)} className={tab === t.id ? 'on' : ''}>{t.label}</button>
        ))}
      </div>

      <div className="panes">
        <section role="tabpanel" id="pane-overview" aria-labelledby="tab-overview" hidden={tab !== 'overview'}>
          <h3>What the source reports</h3>
          <ul className="facts">
            <li>Magnitude: {event.magnitude === null ? 'not reported' : `${event.magnitude.toFixed(1)}${event.magType ? ` (${event.magType})` : ''}`}</li>
            <li>Depth: {event.depthKm === null ? 'not reported' : `${event.depthKm.toFixed(1)} km`}</li>
            <li>Location: {event.place ?? 'not reported'}</li>
            <li>Review status: {event.status ?? 'not reported'}</li>
            {event.alert && <li>USGS PAGER alert level: {event.alert}</li>}
            {event.tsunami !== null && <li>USGS tsunami flag: {event.tsunami ? 'set' : 'not set'}</li>}
            {event.felt !== null && <li>"Did You Feel It?" reports: {event.felt}</li>}
          </ul>
          <h3>What we do not know</h3>
          <ul className="unknown">
            <li>Injuries or casualties</li><li>Damage to buildings or infrastructure</li><li>Number of people affected</li><li>Whether any relief organisation is responding</li>
          </ul>
          <p className="muted small">The USGS feed does not include these details. Marker colour reflects magnitude only, not humanitarian impact.</p>
          {hazard && <SourceRecords sources={hazard.sources} match={hazard.match} quake />}
        </section>
        <section role="tabpanel" id="pane-briefing" aria-labelledby="tab-briefing" hidden={tab !== 'briefing'}><BriefingPanel key={event.id} event={event} health={health} /></section>
        <section role="tabpanel" id="pane-resources" aria-labelledby="tab-resources" hidden={tab !== 'resources'}><ResourcesPanel event={event} /></section>
        <section role="tabpanel" id="pane-preparedness" aria-labelledby="tab-preparedness" hidden={tab !== 'preparedness'}><PreparednessPanel event={event} health={health} healthError={healthError} /></section>
      </div>
    </aside>
  );
}
