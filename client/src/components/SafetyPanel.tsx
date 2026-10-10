import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ExternalLink, History, LocateFixed, Loader2, MapPin, ShieldAlert, Swords, X } from 'lucide-react';
import { CATEGORIES, PROVIDERS, SAFETY_RADII_KM, SAFETY_WINDOWS, type SafetyResponse, type SafetyWindow } from '@shared/types';
import { api } from '../lib/api';
import { formatCoords, formatLocal } from '../lib/format';
import { CategoryIcon } from '../lib/hazards';
import type { LatLng } from './GlobeView';

interface Props {
  pin: LatLng | null;
  onPin: (p: LatLng | null) => void;
  pickMode: boolean;
  onPickMode: (on: boolean) => void;
  regionOf: (p: LatLng) => string | null;
  iso2Of: (p: LatLng) => string | null;
  smsConfigured: boolean | null;
  onSelectEvent: (id: string) => void;
}

const DISCLAIMER = 'Informational aid only. Not an official emergency-warning system. If you are in immediate danger, contact local emergency services and follow official instructions.';
const round = (n: number) => Math.round(n * 1000) / 1000;
const year = (ms: number | null) => (ms === null ? '' : String(new Date(ms).getUTCFullYear()));
/** Survives tab switches so reopening the Safety tab does not re-run the AI for the same pin. */
let lastRun: { key: string; result: SafetyResponse } | null = null;
const runKey = (p: LatLng, radius: number, w: SafetyWindow) => `${round(p.lat)}:${round(p.lng)}:${radius}:${w}`;

export default function SafetyPanel({ pin, onPin, pickMode, onPickMode, regionOf, iso2Of, smsConfigured, onSelectEvent }: Props) {
  const [radius, setRadius] = useState<number>(250);
  const [window_, setWindow] = useState<SafetyWindow>('7d');
  const [lat, setLat] = useState(pin ? String(round(pin.lat)) : '');
  const [lng, setLng] = useState(pin ? String(round(pin.lng)) : '');
  const [result, setResult] = useState<SafetyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [smsErr, setSmsErr] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const run = async (p: LatLng | null = pin) => {
    if (!p) return;
    ctrl.current?.abort();
    const mine = new AbortController();
    ctrl.current = mine;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await api.safety({ latitude: round(p.lat), longitude: round(p.lng), radiusKm: radius, window: window_, region: regionOf(p), iso2: iso2Of(p) }, mine.signal);
      if (!mine.signal.aborted) { setResult(r); lastRun = { key: runKey(p, radius, window_), result: r }; }
    } catch (e) {
      if (!mine.signal.aborted) setError((e as Error).message);
    } finally {
      if (!mine.signal.aborted) setLoading(false);
    }
  };

  // Dropping a pin or using your location starts the check straight away.
  useEffect(() => {
    if (!pin) { ctrl.current?.abort(); setResult(null); setLoading(false); return; }
    setLat(String(round(pin.lat))); setLng(String(round(pin.lng)));
    if (lastRun?.key === runKey(pin, radius, window_)) { setResult(lastRun.result); return; }
    void run(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) { setError('This browser cannot share your location. Drop a pin or enter coordinates instead.'); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); onPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      (err) => {
        setLocating(false);
        setError(err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Allow it in your browser, or drop a pin instead.'
          : err.code === err.TIMEOUT ? 'Getting your location took too long. Try again or drop a pin.' : 'Your location is unavailable right now. Drop a pin instead.');
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  };

  const applyCoords = (e: FormEvent) => {
    e.preventDefault();
    const la = Number(lat); const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180 || lat.trim() === '' || lng.trim() === '') {
      setError('Latitude must be between -90 and 90, longitude between -180 and 180.');
      return;
    }
    onPin({ lat: la, lng: lo });
  };

  const cancel = () => { ctrl.current?.abort(); setLoading(false); };

  const subscribeSms = async () => {
    if (!pin) return;
    setSmsBusy(true); setSmsErr(null); setSmsMsg(null);
    try {
      const r = await api.smsAlert({ phone: phone.trim(), latitude: round(pin.lat), longitude: round(pin.lng), radiusKm: radius });
      setSmsMsg(r.sent.alert
        ? `Alerts are on for the last-4 digits ${r.last4}. A message was sent about ${r.nearbyMajor[0]?.title ?? 'a nearby major event'}.`
        : `Alerts are on for the last-4 digits ${r.last4}. A confirmation was sent. No major disaster is in this radius right now.`);
    } catch (e) {
      setSmsErr((e as Error).message);
    } finally {
      setSmsBusy(false);
    }
  };

  const g = result?.guidance;
  const conflictCountry = result?.conflictCountry ?? null;
  return (
    <aside className="panel safety" aria-label="Safety planner">
      <h2><ShieldAlert size={18} aria-hidden="true" /> Safety planner</h2>
      <p className="notice warn small" role="note"><AlertTriangle size={14} aria-hidden="true" /> {DISCLAIMER}</p>

      <div className="planner-pick">
        <button type="button" className={pickMode ? 'btn primary' : 'btn'} aria-pressed={pickMode} onClick={() => onPickMode(!pickMode)}>
          <MapPin size={14} aria-hidden="true" /> {pickMode ? 'Click the globe to drop the pin…' : pin ? 'Move the pin' : 'Drop a pin on the globe'}
        </button>
        <button type="button" className="btn" onClick={useMyLocation} disabled={locating}>
          {locating ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <LocateFixed size={14} aria-hidden="true" />} {locating ? 'Locating…' : 'Use my location'}
        </button>
        {pin && <button type="button" className="text-btn" onClick={() => { onPin(null); onPickMode(false); }}><X size={12} aria-hidden="true" /> Clear</button>}
      </div>
      <p className="muted small">Your location is used only for this check. It is rounded to about 100 m before it is sent to IMPACT's server and to about 1 km before it reaches the AI, and it is not stored.</p>
      <form className="coord-form" onSubmit={applyCoords} aria-label="Enter coordinates">
        <label className="field"><span>Latitude</span><input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="e.g. 35.68" /></label>
        <label className="field"><span>Longitude</span><input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="e.g. 139.69" /></label>
        <button type="submit" className="btn">Set</button>
      </form>
      {pin && <p className="muted small"><MapPin size={12} aria-hidden="true" /> {formatCoords(pin.lat, pin.lng)}{regionOf(pin) ? ` · ${regionOf(pin)}` : ' · no country boundary at this point'}</p>}

      <div className="coord-form">
        <label className="field"><span>Radius</span>
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{SAFETY_RADII_KM.map((r) => <option key={r} value={r}>{r} km</option>)}</select>
        </label>
        <label className="field"><span>Period</span>
          <select value={window_} onChange={(e) => setWindow(e.target.value as SafetyWindow)}>{(Object.keys(SAFETY_WINDOWS) as SafetyWindow[]).map((w) => <option key={w} value={w}>{SAFETY_WINDOWS[w]}</option>)}</select>
        </label>
      </div>
      <div className="planner-pick">
        <button type="button" className="btn primary" disabled={!pin || loading} onClick={() => void run()}>{loading ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Checking recent events and the disaster record…</> : result ? 'Check again' : 'Check this area'}</button>
        {loading && <button type="button" className="text-btn" onClick={cancel}>Cancel</button>}
      </div>
      {!pin && <p className="muted small">Drop a pin, use your location or enter coordinates. IMPACT checks recent events nearby and the long-term disaster record for the area, then the AI explains what to watch out for and how to prepare.</p>}
      {error && <p className="notice bad small" role="alert">{error}</p>}

      {pin && (
        <section className="block sms-block">
          <h3>SMS alerts for this pin</h3>
          <p className="muted small">Enter a mobile number in international format. IMPACT texts you if a major disaster is reported within the radius: earthquakes M6+, storms, floods, wildfires or volcanoes. Not an official warning system. The number is stored only for these alerts.</p>
          {smsConfigured === false && <p className="notice warn small">SMS is not configured on this server (Twilio credentials missing), so a message cannot be sent yet.</p>}
          <form className="coord-form" onSubmit={(e) => { e.preventDefault(); void subscribeSms(); }}>
            <label className="field"><span>Phone</span><input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" /></label>
            <button type="submit" className="btn primary" disabled={smsBusy || !phone.trim()}>{smsBusy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Sending…</> : 'Text me alerts'}</button>
          </form>
          {smsMsg && <p className="notice info small">{smsMsg}</p>}
          {smsErr && <p className="notice bad small" role="alert">{smsErr}</p>}
        </section>
      )}

      {result && g && (
        <div className="safety-result" aria-live="polite">
          {conflictCountry && (
            <p className="notice bad small conflict-alert" role="alert">
              <Swords size={14} aria-hidden="true" /> <span><b>{conflictCountry.name}</b> is on Wikipedia&apos;s list of countries with an ongoing armed conflict. That is not a map of fighting at this pin; follow official travel advice and local authorities.</span>
            </p>
          )}
          {g.status === 'ok' ? (
            <section className="block">
              <h3>Guidance <small className="muted">AI-generated from the events and history below · {g.model}</small></h3>
              <p>{g.summary}</p>
              {g.hazards.length > 0 && <h4 className="safety-sub">Right now</h4>}
              {g.hazards.map((h) => (
                <div key={h.category} className="safety-hazard">
                  <h4><CategoryIcon category={h.category} size={14} /> {CATEGORIES[h.category].label}{h.eventRefs.length ? <small className="muted"> · based on {h.eventRefs.join(', ')}</small> : null}</h4>
                  <ul>{h.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </div>
              ))}
              {g.watchFor.length > 0 && <h4 className="safety-sub">What to watch out for here</h4>}
              {g.watchFor.map((w) => (
                <div key={w.category} className="safety-hazard watch">
                  <h4><CategoryIcon category={w.category} size={14} /> {CATEGORIES[w.category].label}</h4>
                  <p className="muted small">{w.basis}</p>
                  {w.signs.length > 0 && <><b className="small">Watch for</b><ul>{w.signs.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
                  {w.prepare.length > 0 && <><b className="small">How to prepare</b><ul>{w.prepare.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
                </div>
              ))}
              {g.potentialIssues.length > 0 && <><h4 className="safety-sub">Potential issues</h4><ul>{g.potentialIssues.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
              {g.general.length > 0 && <><h4>General</h4><ul>{g.general.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
              {g.uncertainties.length > 0 && <><h4>Uncertainties</h4><ul className="unknown">{g.uncertainties.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
            </section>
          ) : (
            <p className={g.status === 'unavailable' ? 'notice warn small' : 'notice info small'} role="status">{g.reason}</p>
          )}

          <section className="block">
            <h3>Reported events within {result.radiusKm} km <small className="muted">· {result.range.label}</small></h3>
            {result.facts.length === 0 ? <p className="muted small">None found in the configured sources. That does not mean the area is safe.</p> : (
              <ul className="mini-events">
                {result.facts.map((f) => (
                  <li key={f.ref}>
                    <button type="button" onClick={() => onSelectEvent(f.eventId)}>
                      <span className="mono">{f.ref}</span>
                      <span className="type-swatch" style={{ color: CATEGORIES[f.category].color }}><CategoryIcon category={f.category} size={13} /></span>
                      <span className="mini-title">{f.title}</span>
                      <small>{f.distanceKm} km{f.severity ? ` · ${f.severity}` : ''} · {formatLocal(f.reportedAt)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {result.totalNearby > result.facts.length && <p className="muted small">Showing the {result.facts.length} nearest of {result.totalNearby}.</p>}
          </section>

          {result.history && (
            <section className="block">
              <h3><History size={14} aria-hidden="true" /> Past disasters within {result.history.radiusKm} km</h3>
              {result.history.categories.length === 0 ? <p className="muted small">No past events found in the sources checked. That does not mean the area is safe.</p> : (
                <ul className="history-list">
                  {result.history.categories.map((c) => (
                    <li key={c.category}>
                      <details>
                        <summary>
                          <span className="type-swatch" style={{ color: CATEGORIES[c.category].color }}><CategoryIcon category={c.category} size={13} /></span>
                          <span>{c.basis}</span>
                        </summary>
                        <ul className="source-list">
                          {c.notable.map((n) => (
                            <li key={n.id}>
                              {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title} <ExternalLink size={11} aria-hidden="true" /></a> : <span>{n.title}</span>}
                              <small> · {year(n.time)} · {n.distanceKm} km away</small>
                            </li>
                          ))}
                        </ul>
                        <p className="muted small">{c.category === 'earthquakes' ? 'Largest recorded earthquakes.' : 'Most recent records.'}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="unknown small">{result.history.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </section>
          )}

          <section className="block">
            <h3>Data limitations</h3>
            <ul className="unknown small">{result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <p className="muted small">Sources: {result.dataStatus.map((p) => `${PROVIDERS[p.provider].label} ${p.ok ? (p.stale ? '(stale)' : p.partial ? '(partial)' : 'ok') : '(unavailable)'}`).join(' · ')}</p>
          </section>

          <section className="block">
            <h3>Official sources</h3>
            <ul className="source-list">{result.officialLinks.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <ExternalLink size={11} aria-hidden="true" /></a><small> {l.why}</small></li>)}</ul>
          </section>
          <p className="notice warn small" role="note">{result.disclaimer}</p>
        </div>
      )}
    </aside>
  );
}
