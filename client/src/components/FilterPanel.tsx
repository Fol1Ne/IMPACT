import { useState } from 'react';
import { HidePanel } from './PanelsMenu';
import { CATEGORIES, CONFLICT_PROVIDERS, PROVIDERS, RANGE_PRESETS, type HazardCategory, type HazardSort, type Provider, type RangePreset } from '@shared/types';
import type { RangeSelection } from '../lib/api';
import { CategoryIcon } from '../lib/hazards';

interface Props {
  range: RangeSelection; onRange: (r: RangeSelection) => void;
  categories: Set<HazardCategory>; onToggleCategory: (c: HazardCategory) => void;
  counts: Partial<Record<HazardCategory, number>>;
  sources: Set<Provider>; onToggleSource: (p: Provider) => void;
  minMag: number; onMinMag: (n: number) => void; magFloor: number;
  sort: HazardSort; onSort: (s: HazardSort) => void;
  total: number; shown: number;
  conflictCount: number;
  onHide: () => void;
}

const ALWAYS_LISTED: HazardCategory[] = ['earthquakes', 'wildfires', 'volcanoes', 'floods', 'severeStorms'];
const today = () => new Date().toISOString().slice(0, 10);

export default function FilterPanel(p: Props) {
  const isCustom = !('preset' in p.range);
  const [custom, setCustom] = useState(isCustom);
  const [start, setStart] = useState('start' in p.range ? p.range.start : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [end, setEnd] = useState('end' in p.range ? p.range.end : today());
  const listed = (Object.keys(CATEGORIES) as HazardCategory[]).filter((c) =>
    c === 'conflict' ? true : ALWAYS_LISTED.includes(c) || (p.counts[c] ?? 0) > 0);
  const providers = (Object.keys(PROVIDERS) as Provider[]).filter((s) => !CONFLICT_PROVIDERS.includes(s));
  const countOf = (c: HazardCategory) => (c === 'conflict' ? p.conflictCount : p.counts[c] ?? 0);

  return (
    <section className="panel filters" aria-label="Filters">
      <div className="panel-head"><h2>Event type</h2><HidePanel label="Filters" onHide={p.onHide} /></div>
      <ul className="type-list">
        {listed.map((c) => (
          <li key={c}>
            <label className={p.categories.has(c) ? 'type-row active' : 'type-row'}>
              <input type="checkbox" checked={p.categories.has(c)} onChange={() => p.onToggleCategory(c)} />
              <span className="type-swatch" style={{ color: CATEGORIES[c].color }}><CategoryIcon category={c} size={15} /></span>
              <span>{CATEGORIES[c].label}</span><b>{countOf(c)}</b>
            </label>
          </li>
        ))}
      </ul>

      <label className="field"><span>Date range</span>
        <select value={custom ? 'custom' : (p.range as { preset: RangePreset }).preset} onChange={(e) => {
          if (e.target.value === 'custom') { setCustom(true); return; }
          setCustom(false);
          p.onRange({ preset: e.target.value as RangePreset });
        }}>
          {(Object.keys(RANGE_PRESETS) as RangePreset[]).map((k) => <option key={k} value={k}>{RANGE_PRESETS[k].label}</option>)}
          <option value="custom">Custom dates…</option>
        </select>
      </label>
      {custom && (
        <form className="custom-range" onSubmit={(e) => { e.preventDefault(); p.onRange({ start, end }); }}>
          <label className="field"><span>From (UTC)</span><input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} required /></label>
          <label className="field"><span>To (UTC)</span><input type="date" value={end} min={start} max={today()} onChange={(e) => setEnd(e.target.value)} required /></label>
          <button type="submit" className="btn">Apply</button>
          <p className="muted small">Up to 366 days. Long ranges load in 30-day windows and can take a while the first time.</p>
        </form>
      )}

      <label className="field"><span>Earthquake magnitude</span>
        <select value={p.minMag} onChange={(e) => p.onMinMag(Number(e.target.value))}>
          {[0, 2.5, 4.5, 5, 6, 7].map((m) => <option key={m} value={m} disabled={m > 0 && m < p.magFloor}>{m === 0 ? `Any available (M${p.magFloor}+)` : `M ${m}+`}</option>)}
        </select>
      </label>

      <fieldset className="field sources"><legend>Sources</legend>
        {providers.map((s) => (
          <label key={s}><input type="checkbox" checked={p.sources.has(s)} onChange={() => p.onToggleSource(s)} /> {PROVIDERS[s].label}</label>
        ))}
      </fieldset>

      <label className="field"><span>Sort by</span>
        <select value={p.sort} onChange={(e) => p.onSort(e.target.value as HazardSort)}>
          <option value="time">Most recently updated</option><option value="severity">Largest earthquakes first</option>
        </select>
      </label>
      <p className="count" aria-live="polite">Showing <b>{p.shown}</b> of {p.total} events</p>
    </section>
  );
}
