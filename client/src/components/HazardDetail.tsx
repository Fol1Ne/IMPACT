import { Clock, ExternalLink, Gauge, MapPin, X } from 'lucide-react';
import { CATEGORIES, PROVIDERS, severityLabel, type HazardEvent, type HazardSource } from '@shared/types';
import { formatCoords, formatLocal } from '../lib/format';
import { CategoryIcon, hazardColor } from '../lib/hazards';

/** Every source record behind an event, grouped by provider, with what each one contributed. */
export function SourceRecords({ sources, match, quake }: { sources: HazardSource[]; match: HazardEvent['match']; quake: boolean }) {
  const hasUsgs = sources.some((s) => s.provider === 'usgs');
  const hasEonet = sources.some((s) => s.provider === 'eonet');
  return (
    <div className="block sources-block">
      <h3>Source records</h3>
      {hasUsgs && hasEonet && match && (
        <p className="small">This event is listed by both <b>USGS</b> and <b>NASA EONET</b>. {match.note} Magnitude, depth, time and location shown here come from USGS; NASA EONET's links are kept below.</p>
      )}
      <ul className="source-list">
        {sources.map((s, i) => (
          <li key={`${s.provider}-${s.url ?? i}`}>
            <span className="src-tag">{PROVIDERS[s.provider].label}</span>
            {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label} <ExternalLink size={11} aria-hidden="true" /></a> : <span>{s.label} (no link supplied)</span>}
            <small className="mono"> id {s.providerId}</small>
          </li>
        ))}
      </ul>
      {!quake && hasEonet && <p className="muted small">NASA EONET collects events reported by other agencies; the cited agency is the original source. Positions are reported points or polygon centres, not perimeters or extents.</p>}
    </div>
  );
}

const utcDate = (ms: number | null) => (ms === null ? 'unknown' : new Date(ms).toISOString().slice(0, 10));

function ConflictDetail({ event, onClose }: { event: HazardEvent; onClose: () => void }) {
  const c = event.conflict!;
  const provider = event.sources[0]?.provider ?? 'acled';
  const color = hazardColor(event);
  const span = event.updatedTime !== null && event.updatedTime !== event.startTime ? `${utcDate(event.startTime)} to ${utcDate(event.updatedTime)}` : utcDate(event.startTime);
  return (
    <aside className="panel detail" aria-label="Selected conflict event details">
      <header className="detail-head">
        <span className="badge" style={{ background: `${color}22`, borderColor: color, color }}><CategoryIcon category="conflict" size={18} /></span>
        <div><small>{c.eventType}</small><h2>{event.title}</h2></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close event details"><X size={16} /></button>
      </header>
      <dl className="stats two">
        <div><dt><Gauge size={14} aria-hidden="true" /> {provider === 'ucdp' ? 'Deaths (best estimate)' : 'Reported fatalities'}</dt><dd>{c.fatalities ?? 'n/a'}<small>{provider === 'ucdp' ? 'UCDP "best" estimate; preliminary' : 'as coded by ACLED; often revised'}</small></dd></div>
        <div><dt><Clock size={14} aria-hidden="true" /> Event date</dt><dd className="time">{span}<small>UTC calendar date; no time of day is reported</small></dd></div>
      </dl>
      <p className="loc"><MapPin size={14} aria-hidden="true" /> <span className="mono">{formatCoords(event.latitude, event.longitude)}</span> <small>{c.locationPrecision ?? 'precision not stated'}</small></p>
      <ul className="facts">
        {c.subEventType && <li>{provider === 'ucdp' ? 'Conflict' : 'Type'}: {c.subEventType}</li>}
        {c.actors.length > 0 && <li>{provider === 'ucdp' ? 'Sides' : 'Actors'}: {c.actors.join(' vs ')}</li>}
        {event.place && <li>Location: {event.place}</li>}
        {event.description && <li>{provider === 'ucdp' ? 'Dyad' : 'ACLED notes'}: {event.description}</li>}
      </ul>
      <SourceRecords sources={event.sources} match={null} quake={false} />
      <h3>What we do not know</h3>
      <ul className="unknown"><li>Front lines, territorial control or where fighting is happening now</li><li>Whether the area is safe to enter or travel through</li><li>Incidents that were never reported or not yet coded</li></ul>
      <p className="muted small">
        {provider === 'ucdp'
          ? 'Data: Uppsala Conflict Data Program (UCDP) Candidate Events Dataset, CC BY 4.0. Candidate data is preliminary and may change.'
          : 'Data: Armed Conflict Location & Event Data (ACLED), acleddata.com. Coded from news, local partners and other reports; figures are revised as information arrives.'}
        {' '}For travel decisions, follow your government's official travel advice and local authorities.
      </p>
    </aside>
  );
}

export default function HazardDetail({ event, onClose }: { event: HazardEvent; onClose: () => void }) {
  if (event.conflict) return <ConflictDetail event={event} onClose={onClose} />;
  const color = hazardColor(event);
  const sev = severityLabel(event.severity);
  return (
    <aside className="panel detail" aria-label="Selected event details">
      <header className="detail-head">
        <span className="badge" style={{ background: `${color}22`, borderColor: color, color }}><CategoryIcon category={event.category} size={18} /></span>
        <div><small>{CATEGORIES[event.category].label}</small><h2>{event.title}</h2></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close event details"><X size={16} /></button>
      </header>
      <dl className="stats two">
        <div><dt><Gauge size={14} aria-hidden="true" /> Reported size</dt><dd>{sev ?? 'n/a'}<small>{event.severity ? `as reported to ${PROVIDERS[event.severity.provider].label}` : 'not supplied by the source'}</small></dd></div>
        <div><dt><Clock size={14} aria-hidden="true" /> Latest report</dt><dd className="time">{formatLocal(event.updatedTime)}<small>{event.closedTime ? `closed ${formatLocal(event.closedTime)}` : 'open in the source'}</small></dd></div>
      </dl>
      <p className="loc"><MapPin size={14} aria-hidden="true" /> <span className="mono">{formatCoords(event.latitude, event.longitude)}</span> <small>{event.geometryType === 'polygon' ? 'centre of the reported area' : event.geometryType === 'track' ? `latest of ${event.track.length} reported positions (track shown on globe)` : 'reported point'}</small></p>
      <ul className="facts">
        <li>First reported: {formatLocal(event.startTime)}</li>
        {event.description && <li>Source description: {event.description}</li>}
      </ul>
      <SourceRecords sources={event.sources} match={event.match} quake={false} />
      <h3>What we do not know</h3>
      <ul className="unknown"><li>Current extent, perimeter or intensity beyond the reported value</li><li>Damage, casualties or people affected</li><li>Official warnings or evacuation orders in force</li></ul>
      <p className="muted small">For warnings, follow your national meteorological, fire or civil-protection authority. IMPACT is not an official alerting service.</p>
    </aside>
  );
}
