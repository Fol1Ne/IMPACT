import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConflictsResponse } from '@shared/types';
import { api } from '../lib/api';

export function useConflicts() {
  const [data, setData] = useState<ConflictsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    ctrl.current?.abort();
    const mine = new AbortController();
    ctrl.current = mine;
    setLoading(true);
    try {
      const res = await api.conflicts(refresh, mine.signal);
      if (mine.signal.aborted) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (mine.signal.aborted) return;
      setError((e as Error).message);
    } finally {
      if (!mine.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); return () => ctrl.current?.abort(); }, [load]);
  return { data, loading, error, refresh: () => load(true) };
}
