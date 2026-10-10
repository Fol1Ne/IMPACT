import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { QuakeEvent, ResourceItem } from '@shared/types';
import { api } from '../lib/api';

export default function ResourcesPanel({ event }: { event: QuakeEvent }) {
  const [res, setRes] = useState<{ general: ResourceItem[]; incidentSpecificDonation: { message: string } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.resources().then(setRes).catch((e: Error) => setErr(e.message)); }, []);
  return (
    <div className="resources">
      <h3>For this event</h3>
      <ul className="res-list">
        {event.url
          ? <li><div><b>USGS event page</b><p>Official, regularly updated record for this specific earthquake.</p></div><a className="btn" href={event.url} target="_blank" rel="noopener noreferrer">Open <ExternalLink size={12} aria-hidden="true" /></a></li>
          : <li><p className="muted">USGS did not supply an event page for this record.</p></li>}
      </ul>
      <p className="notice info">{res?.incidentSpecificDonation.message ?? 'No verified incident-specific donation page is available.'}</p>
      <h3>General humanitarian resources</h3>
      <p className="muted small">These are general organisations. IMPACT does not claim any of them is responding to this earthquake.</p>
      {err && <p className="notice bad" role="alert">Could not load resources: {err}</p>}
      <ul className="res-list">
        {res?.general.map((r) => (
          <li key={r.url}><div><b>{r.name}</b><small>{r.category}</small><p>{r.why}</p></div><a className="btn" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${r.name} (external site)`}>Visit <ExternalLink size={12} aria-hidden="true" /></a></li>
        ))}
      </ul>
      <p className="muted small">External links open the organisations' own sites. They are separate from IMPACT's sandbox purchase, which does not send money to anyone.</p>
    </div>
  );
}
