import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { configureSession, clearSession } from "../../api/client";
import { getSession, type Session } from "../../api/session";
import { Skeleton } from "../../ui/Skeleton";

interface SessionState {
  session: Session | null;
  error: unknown;
  reload: () => Promise<void>;
}
const Context = createContext<SessionState>({ session: null, error: null, reload: async () => {} });
export const useSession = () => useContext(Context);

export function SessionProvider({ children }: { children: ReactNode }) {
  const generation = useRef(0);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const turn = ++generation.current;
    setLoading(true);
    setSession(null);
    clearSession();
    try {
      const result = await getSession();
      if (turn !== generation.current) return;
      if (typeof result?.authenticated !== "boolean") throw new Error("Invalid session response");
      configureSession(result.csrf_token, result.kind === "demo");
      setSession(result);
      setError(null);
    } catch (cause) { if (turn === generation.current) setError(cause); }
    finally { if (turn === generation.current) setLoading(false); }
  }
  useEffect(() => { void reload(); return () => { generation.current++; }; }, []);

  if (loading) return <div role="status" aria-label="Checking your session" className="p-8"><Skeleton className="h-24" /></div>;
  return <Context.Provider value={{ session, error, reload }}>{children}</Context.Provider>;
}
