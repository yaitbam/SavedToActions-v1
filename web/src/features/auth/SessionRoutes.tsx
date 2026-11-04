import { Navigate, Outlet } from "react-router-dom";
import { SessionProvider, useSession } from "./SessionContext";
import { NewSaveProvider } from "../newSave/NewSaveContext";

export function SessionRoutes() {
  return <SessionProvider><Outlet /></SessionProvider>;
}
export function RequireWorkspace() {
  const { session } = useSession();
  if (!session?.authenticated) return <Navigate to="/login" replace />;
  if (!session.profile_complete && session.kind !== "demo") return <Navigate to="/complete-profile" replace />;
  return <NewSaveProvider><Outlet /></NewSaveProvider>;
}
