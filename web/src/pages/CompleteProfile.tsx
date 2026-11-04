import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { saveProfile } from "../api/session";
import { errorText } from "../api/errors";
import { AuthLayout } from "../features/auth/AuthLayout";
import { useSession } from "../features/auth/SessionContext";
import { useAlert } from "../ui/AlertProvider";
import { InlineAlert } from "../ui/InlineAlert";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { fieldClass } from "../ui/cx";

export function CompleteProfile() {
  const { session, reload } = useSession();
  const [name, setName] = useState(session?.name ?? "");
  // Name validation stays inline under the field. A failed save comes from the server and uses the popup.
  const [error, setError] = useState<string | null>(null);
  const alert = useAlert();
  const [busy, setBusy] = useState(false);
  if (!session?.authenticated) return <Navigate to="/login" replace />;
  if (session.profile_complete || session.kind === "demo") return <Navigate to="/app" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || name.trim().length > 80) { setError("Use a name between 1 and 80 characters"); return; }
    setError(null); setBusy(true);
    try { await saveProfile(name.trim()); await reload(); }
    catch (cause) { alert.error(errorText(cause), { title: "Could not save your name" }); }
    finally { setBusy(false); }
  }
  return <AuthLayout><Card className="space-y-6">
    <h1 className="text-title">Confirm your details</h1>
    <form onSubmit={event => void submit(event)} className="space-y-5">
      <label className="block space-y-2"><span>Name</span><input autoComplete="name" required maxLength={80} value={name} onChange={event => { setName(event.target.value); setError(null); }} className={fieldClass} /></label>
      {error && <InlineAlert>{error}</InlineAlert>}
      <label className="block space-y-2"><span>Email (from Google)</span><input type="email" readOnly value={session.email ?? ""} className={`${fieldClass} bg-bg`} /></label>
      <p className="text-small text-muted">Only you can access your workspace. Calendar connection comes next.</p>      <Button type="submit" loading={busy}>Continue</Button>
    </form>
  </Card></AuthLayout>;
}
