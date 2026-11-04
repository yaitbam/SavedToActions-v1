import { useState, type FormEvent } from "react";
import { logout, saveProfile } from "../../api/session";
import { clearSession } from "../../api/client";
import { errorText } from "../../api/errors";
import { useSession } from "../auth/SessionContext";
import { useAlert } from "../../ui/AlertProvider";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { fieldClass } from "../../ui/cx";

export function Account() {
  const { session, reload } = useSession();
  const [name, setName] = useState(session?.name ?? "");
  const [busy, setBusy] = useState(false);
  const alert = useAlert();
  const demo = session?.kind === "demo";
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await saveProfile(name.trim()); await reload(); }
    catch (cause) { alert.error(errorText(cause), { title: "Could not save your name" }); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try { await logout(); clearSession(); window.location.replace("/login"); }
    catch (cause) { alert.error(errorText(cause, "Could not sign out. Try again")); setBusy(false); }
  }
  return <Card className="space-y-4">
    <h2 className="text-base">Account</h2>
    <form onSubmit={event => void save(event)} className="space-y-4">
      <label className="block space-y-2"><span className="text-small">Name</span><input required maxLength={80} disabled={demo || busy} value={name} onChange={event => setName(event.target.value)} className={fieldClass} /></label>
      <label className="block space-y-2"><span className="text-small">Email (from Google)</span><input readOnly value={session?.email ?? ""} className={`${fieldClass} bg-bg`} /></label>
      {!demo && <Button type="submit" variant="secondary" disabled={busy || !name.trim() || name.trim() === session?.name}>Save name</Button>}
    </form>
    <div className="flex flex-wrap gap-3"><Button variant="secondary" loading={busy} onClick={() => void signOut()}>Sign out</Button>
      <Button variant="text" disabled title="Account deletion is not connected yet">Delete my account and data</Button></div>  </Card>;
}
