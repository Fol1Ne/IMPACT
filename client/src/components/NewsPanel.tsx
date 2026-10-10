import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Newspaper, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { HazardEvent, NewsResponse } from '@shared/types';
import { ApiError, api } from '../lib/api';
import type { Country } from '../lib/countries';
import { formatLocal, relativeTime } from '../lib/format';
import { CategoryIcon, hazardColor, hazardName, hazardSeverity, hazardTime } from '../lib/hazards';

interface Props {
  country: Country | null;
  countries: Country[];
  onSelectCountry: (country: Country | null) => void;
  countryEvents: HazardEvent[];
  onSelectEvent: (id: string) => void;
}

const NEWS_PAGE = 10;

export default function NewsPanel({ country, countries, onSelectCountry, countryEvents, onSelectEvent }: Props) {
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [error, setError] = useState<{ message: string; limited: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [shown, setShown] = useState(NEWS_PAGE);
  const forceRefresh = useRef(false);
  const iso2 = country?.iso2 ?? null;
  const unmapped = Boolean(country && !iso2);
  const refresh = () => { forceRefresh.current = true; setReload((n) => n + 1); };

  useEffect(() => {
    setNews(null);
    setError(null);
    setShown(NEWS_PAGE);
    if (unmapped) { setLoading(false); return; }
    const ctrl = new AbortController();
    const force = forceRefresh.current;
    forceRefresh.current = false;
    setLoading(true);
    api.news(iso2, force, ctrl.signal)
      .then((data) => { if (!ctrl.signal.aborted) setNews(data); })
      .catch((e: ApiError) => { if (!ctrl.signal.aborted) setError({ message: e.message, limited: e.status === 429 }); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [iso2, unmapped, reload]);

  const scopeName = country ? country.name : 'Global disaster news';

  return (
    <div className="news">
      <header className="news-head">
        <Newspaper size={18} aria-hidden="true" />
        <div>
          <small>{country ? 'Country news' : 'No country selected'}</small>
          <h2>{scopeName}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={refresh} disabled={loading || unmapped} aria-label="Refresh news"><RefreshCw size={14} className={loading ? 'spin' : undefined} /></button>
        {country && <button type="button" className="icon-btn" onClick={() => onSelectCountry(null)} aria-label="Clear country and return to global view"><X size={14} /></button>}
      </header>

      <label className="news-pick">
        <span className="sr-only">Choose a country</span>
        <select value={country ? (country.iso2 ?? country.name) : ''} onChange={(e) => onSelectCountry(countries.find((c) => (c.iso2 ?? c.name) === e.target.value) ?? null)}>
          <option value="">Global (no country)</option>
          {countries.map((c) => <option key={c.iso2 ?? c.name} value={c.iso2 ?? c.name}>{c.name}</option>)}
        </select>
      </label>
      {!country && <p className="muted small">Click any country on the globe, or choose one above, for headlines about that country.</p>}

      {country?.iso2 === 'RU' && (
        <p className="muted small">The lighter areas (Crimea, Donetsk, Luhansk, Kherson and Zaporizhzhia) are shown with Russia but are not part of the country. Those shapes follow oblast boundaries, not a front line.</p>
      )}

      {country && (
        <section className="country-events" aria-label={`Events located in ${country.name}`}>
          <h3><ShieldCheck size={14} aria-hidden="true" /> Event records in {country.name} <small>{countryEvents.length}</small></h3>
          {countryEvents.length === 0
            ? <p className="muted small">No events in the current filters have a reported position inside this country's boundary. Offshore earthquakes and events near borders may be missed.</p>
            : (
              <ul className="mini-events">
                {countryEvents.slice(0, 8).map((e) => (
                  <li key={e.id}><button type="button" onClick={() => onSelectEvent(e.id)}>
                    <span style={{ color: hazardColor(e) }}><CategoryIcon category={e.category} /></span>
                    <span className="mini-title">{hazardSeverity(e) ? `${hazardSeverity(e)} · ` : ''}{hazardName(e)}</span>
                    <small>{relativeTime(hazardTime(e))}</small>
                  </button></li>
                ))}
              </ul>
            )}
          {countryEvents.length > 8 && <p className="muted small">And {countryEvents.length - 8} more in the event list.</p>}
        </section>
      )}

      <section aria-label="News coverage">
        <h3 className="news-section"><Newspaper size={14} aria-hidden="true" /> News coverage <small>headlines, not verified event records</small></h3>
        {unmapped && <p className="notice info">This area has no ISO country code in the boundary data, so country news cannot be looked up.</p>}
        {loading && !news && <p className="news-loading" role="status"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading headlines…</p>}
        {error && (
          <div className={error.limited ? 'notice warn' : 'notice bad'} role="alert">
            {error.limited ? 'News provider rate limit reached. ' : ''}{error.message}
            <button type="button" className="btn" onClick={refresh}><RefreshCw size={12} aria-hidden="true" /> Try again</button>
          </div>
        )}
        {news?.meta.stale && <p className="notice warn"><AlertTriangle size={14} aria-hidden="true" /> {news.meta.staleReason}</p>}
        {news && news.items.length === 0 && <p className="muted">No headlines came back for this search. That can mean a quiet period in the sample, not an absence of events.</p>}

        {news && news.items.length > 0 && (
          <ul className="news-list">
            {news.items.slice(0, shown).map((item) => (
              <li key={item.id}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  <span className="news-meta"><b>{item.sourceName}</b><time dateTime={new Date(item.publishedAt).toISOString()} title={formatLocal(item.publishedAt)}>{relativeTime(item.publishedAt)}</time></span>
                  <span className="news-title">{item.headline} <ExternalLink size={11} aria-hidden="true" /></span>
                  {!item.headlineMatch && <span className="news-flag">{country ? `Keyword hit, headline does not name ${news.countryName}` : 'Keyword hit, headline does not name a hazard'}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
        {news && news.items.length > shown && <button type="button" className="btn" onClick={() => setShown((n) => n + NEWS_PAGE)}>Show more headlines ({news.items.length - shown} more)</button>}
        {news && <p className="muted small">{news.meta.scopeNote} Google News supplies headlines and links only; no article text is copied. Fetched {formatLocal(news.meta.fetchedAt)}.</p>}
      </section>
    </div>
  );
}
