import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "./SessionContext";
import { useSignOut } from "./useSignOut";
import { Button } from "../../ui/Button";

export function ProfileMenu() {
  const { session } = useSession();
  const { signOut, signingOut } = useSignOut();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const demo = session?.kind === "demo";
  const name = session?.name || (demo ? "Demo" : "Your account");

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return <div ref={root} className="profile-menu">
    <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={`Account menu for ${name}`} onClick={() => setOpen(value => !value)} className="profile-trigger">
      <svg className="profile-avatar" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle cx="16" cy="16" r="16" fill="currentColor" opacity=".14" />
        <circle cx="16" cy="12.5" r="5" fill="currentColor" />
        <path d="M3.7 26.2C6.3 22 10.3 19.2 16 19.2S25.7 22 28.3 26.2A16 16 0 0 1 3.7 26.2z" fill="currentColor" />
      </svg>
      <span className="profile-trigger-name">{name}</span>
    </button>
    {open && <div id={panelId} role="dialog" aria-label="Account" className="profile-panel animate-enter">
      <p className="profile-signed-in">{demo ? "Demo workspace" : "Signed in as"}</p>
      <strong className="profile-name">{name}</strong>
      {session?.email && <span className="profile-email">{session.email}</span>}
      <div className="profile-actions">
        <Link to="/app/settings" onClick={() => setOpen(false)} className="text-small font-medium text-ink underline underline-offset-4">Account settings</Link>
        <Button variant="secondary" loading={signingOut} onClick={() => void signOut()} className="h-10 px-4 text-small">Sign out</Button>
      </div>
    </div>}
  </div>;
}
