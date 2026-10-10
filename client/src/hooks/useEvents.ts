import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventsResponse, FeedId } from '@shared/types';
import { api } from '../lib/api';

export function useEvents(feed: FeedId) {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (refresh: boolean) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await api.events(feed, refresh);
      if (my !== seq.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setError((e as Error).message); // previous data (if any) stays on screen
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [feed]);

  useEffect(() => { void load(false); }, [load]);
  // Re-check every 5 minutes without hammering the server.
  useEffect(() => { const t = setInterval(() => void load(false), 300_000); return () => clearInterval(t); }, [load]);

  return { data, loading, error, refresh: () => load(true) };
}
