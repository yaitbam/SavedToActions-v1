import { useCallback, useEffect, useRef, useState } from "react";

// Small loader hook: runs `load` on mount and whenever `deps` change.
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  const seq = useRef(0);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const turn = ++seq.current;
    setLoading(true);
    try {
      const value = await loadRef.current();
      if (turn !== seq.current) return;
      setData(value);
      setError(null);
    } catch (e) {
      if (turn === seq.current) setError(e);
    } finally {
      if (turn === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, deps);

  return { data, error, loading, reload };
}
