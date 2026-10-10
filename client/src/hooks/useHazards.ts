import { useCallback, useEffect, useRef, useState } from 'react';
import type { HazardsResponse } from '@shared/types';
import { api, rangeQuery, type RangeSelection } from '../lib/api';

export const POLL_MS = 5 * 60_000;

/** Loads hazards for a range. A newer request aborts the previous one, so stale responses never overwrite fresh ones. */
export function useHazards(range: RangeSelection) {
  const [data, setData] = useState<HazardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const key = rangeQuery(range);

  const load = useCallback(async (refresh: boolean) => {
    ctrl.current?.abort();
    const mine = new AbortController();
    ctrl.current = mine;
    setLoading(true);
    try {
      const res = await api.hazards(range, refresh, mine.signal);
      if (mine.signal.aborted) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (mine.signal.aborted) return;
      setError((e as Error).message); // previous data (if any) stays on screen
    } finally {
      if (!mine.signal.aborted) setLoading(false);
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(false); return () => ctrl.current?.abort(); }, [load]);
  useEffect(() => { const t = setInterval(() => void load(false), POLL_MS); return () => clearInterval(t); }, [load]);

  return { data, loading, error, refresh: () => load(true) };
}
