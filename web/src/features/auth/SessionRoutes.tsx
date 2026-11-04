import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { SessionProvider, useSession } from "./SessionContext";
import { NewSaveProvider } from "../newSave/NewSaveContext";

// If the session cannot be read at all (the API is down or answers with an error), nothing else can work.
// Go to the 500 page and remember where the visitor was going.
function SessionGate() {
  const { session, error } = useSession();
  const location = useLocation();
  if (error && !session) return <Navigate to="/500" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function SessionRoutes() {
  return <SessionProvider><SessionGate /></SessionProvider>;
}
// The page a signed out visitor asked for is remembered across the Google round trip, so after signing in
// they land there and not on Overview. It expires, and only paths inside the app are ever used.
const RETURN_KEY = "sta-return";
const RETURN_TTL_MS = 10 * 60 * 1000;

function rememberReturn(path: string) {
  if (!path.startsWith("/app/")) return;
  try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path, at: Date.now() })); } catch { /* Landing on Overview is fine. */ }
}

function takeReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    const saved = raw ? (JSON.parse(raw) as { path?: unknown; at?: unknown }) : null;
    if (typeof saved?.path !== "string" || typeof saved.at !== "number" || Date.now() - saved.at > RETURN_TTL_MS) return null;
    return saved.path.startsWith("/app/") && !saved.path.startsWith("//") ? saved.path : null;
  } catch { return null; }
}

export function RequireWorkspace() {
  const { session } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const ready = !!session?.authenticated && (session.profile_complete || session.kind === "demo");
  useEffect(() => {
    if (!ready || location.pathname !== "/app") return;
    const back = takeReturn();
    if (back) navigate(back, { replace: true });
  }, [ready, location.pathname, navigate]);
  if (!session?.authenticated) {
    rememberReturn(location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }
  if (!session.profile_complete && session.kind !== "demo") return <Navigate to="/complete-profile" replace />;
  return <NewSaveProvider><Outlet /></NewSaveProvider>;
}
