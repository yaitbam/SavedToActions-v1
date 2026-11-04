import { useEffect, useRef, type ReactElement } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { getAuthStatus } from "../api/auth";
import { listSaves } from "../api/saves";
import { useAsync } from "../api/useAsync";
import { ProfileMenu } from "../features/auth/ProfileMenu";
import { useSession } from "../features/auth/SessionContext";
import { useNewSave } from "../features/newSave/NewSaveContext";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Logo } from "../ui/Logo";
import { HomeIcon, ProgressIcon, SavesIcon, SettingsIcon } from "./icons";
import "./shell.css";

// Press G, then the key, to jump. Ignored while typing or while a dialog is open.
const items: Array<{ to: string; label: string; short: string; key: string; icon: ReactElement; end?: boolean }> = [
  { to: "/app", label: "Overview", short: "G H", key: "h", icon: <HomeIcon />, end: true },
  { to: "/app/saves", label: "Saved", short: "G S", key: "s", icon: <SavesIcon /> },
  { to: "/app/progress", label: "Progress", short: "G P", key: "p", icon: <ProgressIcon /> },
  { to: "/app/settings", label: "Settings", short: "G ,", key: ",", icon: <SettingsIcon /> },
];

function useGoShortcuts() {
  const navigate = useNavigate();
  const armed = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      if (armed.current !== null) {
        window.clearTimeout(armed.current);
        armed.current = null;
        const hit = items.find((item) => item.key === key);
        if (hit) { event.preventDefault(); navigate(hit.to); }
        return;
      }
      if (key === "g") armed.current = window.setTimeout(() => { armed.current = null; }, 900);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

export function AppShell() {
  const { session } = useSession();
  const { open } = useNewSave();
  const location = useLocation();
  const demo = session?.kind === "demo";
  useGoShortcuts();
  // Light facts for the sidebar. A failure leaves the calendar status and count out rather than blocking the page.
  const facts = useAsync(async () => {
    const [auth, saves] = await Promise.all([getAuthStatus().catch(() => null), listSaves({ limit: 1 }).catch(() => null)]);
    return { connected: auth?.connected ?? null, total: saves?.total ?? null };
  }, [location.pathname]);
  const connected = facts.data?.connected;
  const total = facts.data?.total;

  const drop = (className?: string) => <Button disabled={demo} aria-label="Drop screenshot" title={demo ? "Sign in to do this" : "Or paste a screenshot with ⌘V"} onClick={() => open()} className={cx("text-small", className)}>
    <span aria-hidden="true">＋</span><span className="new-save-label">Drop screenshot</span>
  </Button>;

  return <div className="app-shell">
    <aside className="sidebar">
      <NavLink to="/app" aria-label="Overview" className="sidebar-logo"><Logo /></NavLink>
      {drop("side-drop")}
      <nav aria-label="Main" className="sidenav">
        {items.map((item) => <NavLink key={item.to} to={item.to} end={item.end} title={`${item.label}. Shortcut ${item.short}`} className={({ isActive }) => cx(isActive && "active")}>
          {item.icon}
          <span className="label">{item.label}</span>
          {item.to === "/app/saves" && total != null && <span className="count">{total}</span>}
        </NavLink>)}
      </nav>
      <div className="side-foot">
        {!demo && connected !== null && connected !== undefined && (connected
          ? <Link to="/app/settings" className="cal-pill on" title="Google Calendar is connected"><i aria-hidden="true" /><span>Calendar connected</span></Link>
          : <Link to="/app/settings" className="cal-pill off"><i aria-hidden="true" /><span>Connect calendar</span></Link>)}
        <ProfileMenu />
      </div>
    </aside>
    <div className="app-main">
      <header className="app-topbar">
        <NavLink to="/app" aria-label="Overview"><Logo compact /></NavLink>
        <div className="topbar-right">
            {drop("topbar-drop")}
          <ProfileMenu />
        </div>
      </header>
      <main className="app-canvas">
        {demo && <div role="status" className="mb-6 rounded-card border border-line bg-accent p-4 text-small font-medium">Demo workspace. Read only. Imported demo data</div>}
        <Outlet />
      </main>
    </div>
    <nav aria-label="Main" className="app-mobile-nav">
      {items.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cx(isActive && "active")}>{item.icon}<span>{item.label.split(" ")[0]}</span></NavLink>)}
    </nav>
  </div>;
}
