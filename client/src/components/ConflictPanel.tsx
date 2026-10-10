import { AlertTriangle, Crosshair, Swords } from 'lucide-react';
import type { ConflictCountry } from '@shared/types';
import { formatLocal } from '../lib/format';

interface Props {
  countries: ConflictCountry[];
  sourceUrl: string;
  pageTitle: string;
  fetchedAt: number | null;
  stale: boolean;
  notes: string[];
  error: string | null;
  categoryOn: boolean;
  onOpenCountry: (iso2: string) => void;
}

export default function ConflictPanel({ countries, sourceUrl, pageTitle, fetchedAt, stale, notes, error, categoryOn, onOpenCountry }: Props) {
  return (
    <aside className="panel conflict-panel" aria-label="Armed conflict">
      <h2><Swords size={18} aria-hidden="true" /> Countries in current conflict</h2>
      <p className="muted small">
        Wikipedia · <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{pageTitle}</a>
        {fetchedAt ? ` · fetched ${formatLocal(fetchedAt)}` : ''}
      </p>
      {error && <p className="notice bad small" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</p>}
      {stale && <p className="notice warn small" role="status">Showing a previously fetched list because Wikipedia could not be reached just now.</p>}
      {notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
      {!categoryOn && <p className="notice info small">Armed conflict is switched off in the event-type filter, so country highlighting is hidden on the globe. The list below is unchanged.</p>}

      <section className="block">
        <h3>Listed countries <em>{countries.length}</em></h3>
        {countries.length === 0 && !error ? <p className="muted small">No countries could be read from the source list.</p> : (
          <ol className="zone-list">
            {countries.map((c, i) => (
              <li key={c.iso2}>
                <button type="button" onClick={() => onOpenCountry(c.iso2)} title="Show this country on the globe and open its news">
                  <span className="zone-rank mono">{i + 1}</span>
                  <span className="zone-name">{c.name}<small>{c.iso2}</small></span>
                  <Crosshair size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="muted small">This is Wikipedia&apos;s current list of locations, not a date-filtered event feed and not an official war-zone map. Click a country to fly there and see its news.</p>
    </aside>
  );
}
