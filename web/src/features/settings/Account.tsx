import { useState, type FormEvent } from "react";
import { saveProfile } from "../../api/session";
import { errorText } from "../../api/errors";
import { useSession } from "../auth/SessionContext";
import { useSignOut } from "../auth/useSignOut";
import { useAlert } from "../../ui/AlertProvider";
import { Button } from "../../ui/Button";
import { fieldClass } from "../../ui/cx";
import { DeleteAccount } from "./DeleteAccount";
import { SettingsSection } from "./SettingsSection";

export function Account() {
  const { session, reload } = useSession();
  const [name, setName] = useState(session?.name ?? "");
  const [busy, setBusy] = useState(false);
  const alert = useAlert();
  const { signOut, signingOut } = useSignOut();
  const demo = session?.kind === "demo";
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await saveProfile(name.trim()); await reload(); }
    catch (cause) { alert.error(errorText(cause), { title: "Could not save your name" }); }
    finally { setBusy(false); }
  }
  return <SettingsSection title="Account" description="Your name is shown in the app. Your email comes from Google and cannot be changed here.">
    <form onSubmit={event => void save(event)} className="space-y-4">
      <div className="st-grid">
        <label><span className="st-label">Name</span><input required maxLength={80} disabled={demo || busy} value={name} onChange={event => setName(event.target.value)} className={fieldClass} /></label>
        <label><span className="st-label">Email (from Google)</span><input readOnly value={session?.email ?? ""} className={`${fieldClass} bg-bg`} /></label>
      </div>
      {!demo && <Button type="submit" variant="secondary" disabled={busy || !name.trim() || name.trim() === session?.name}>Save name</Button>}
    </form>
    <div className="st-actions border-t border-line pt-5">
      <Button variant="secondary" loading={signingOut} onClick={() => void signOut()}>Sign out</Button>
      <DeleteAccount disabled={demo} />
    </div>
  </SettingsSection>;
}
