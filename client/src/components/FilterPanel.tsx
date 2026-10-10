import { Activity, Flame } from 'lucide-react';
import { FEEDS, type FeedId, type SortKey } from '@shared/types';

interface Props {
  feed: FeedId; onFeed: (f: FeedId) => void;
  minMag: number; onMinMag: (n: number) => void;
  sort: SortKey; onSort: (s: SortKey) => void;
  total: number; shown: number;
}

export default function FilterPanel({ feed, onFeed, minMag, onMinMag, sort, onSort, total, shown }: Props) {
  return (
    <section className="panel filters" aria-label="Filters">
      <h2>Disaster type</h2>
      <div className="type-row active"><Activity size={16} aria-hidden="true" /><span>Earthquakes</span><b>{total}</b></div>
      <div className="type-row disabled" title="NASA FIRMS data is not connected in this version">
        <Flame size={16} aria-hidden="true" /><span>Wildfires</span><em>not connected</em>
      </div>
      <label className="field"><span>Time window</span>
        <select value={feed} onChange={(e) => onFeed(e.target.value as FeedId)}>
          {(Object.keys(FEEDS) as FeedId[]).map((k) => <option key={k} value={k}>{FEEDS[k].label}</option>)}
        </select>
      </label>
      <label className="field"><span>Minimum magnitude</span>
        <select value={minMag} onChange={(e) => onMinMag(Number(e.target.value))}>
          {[0, 2.5, 4.5, 5, 6, 7].map((m) => <option key={m} value={m}>{m === 0 ? 'Any' : `M ${m}+`}</option>)}
        </select>
      </label>
      <label className="field"><span>Sort by</span>
        <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
          <option value="time">Most recent</option><option value="magnitude">Largest magnitude</option>
        </select>
      </label>
      <p className="count" aria-live="polite">Showing <b>{shown}</b> of {total} events</p>
    </section>
  );
}
