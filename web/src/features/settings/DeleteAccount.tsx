import { useEffect, useRef, useState } from "react";
import { clearSession } from "../../api/client";
import { errorText } from "../../api/errors";
import { CONFIRM_DELETE_ACCOUNT, deleteAccount } from "../../api/session";
import { Button } from "../../ui/Button";
import { fieldClass } from "../../ui/cx";
import { InlineAlert } from "../../ui/InlineAlert";

// Permanent. The user must type the confirmation text. Events already on Google Calendar are kept.
export function DeleteAccount({ disabled }: { disabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function close() {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setError(null);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAccount();
      clearSession();
      window.location.replace(`/login?deleted=${result.google_revoked === false ? "2" : "1"}`);
    } catch (cause) {
      setError(errorText(cause, "Could not delete your account. Nothing was removed"));
      setBusy(false);
    }
  }

  return <>
    <Button variant="text" onClick={() => setOpen(true)} disabled={disabled} className="text-nofit">Delete my account and data</Button>
    <dialog ref={dialog} onClose={close} onCancel={(event) => busy && event.preventDefault()} aria-labelledby="delete-account-title"
      className="m-auto w-[min(92vw,32rem)] rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-ink/70">
      {open && <form className="space-y-4 p-6" onSubmit={(event) => { event.preventDefault(); if (typed === CONFIRM_DELETE_ACCOUNT) void remove(); }}>
        <h2 id="delete-account-title" className="font-display text-lg">Delete your account and data?</h2>
        <p className="text-small text-muted">This permanently removes from SavedToAction:</p>
        <ul className="list-disc space-y-1 pl-5 text-small">
          <li>Your saves, screenshots and everything extracted from them</li>
          <li>Your settings, goal names and plans</li>
          <li>Your sign in and your Google Calendar connection. We ask Google to revoke access</li>
        </ul>
        <p className="rounded-card bg-missing-bg px-4 py-3 text-small">Events already on your Google Calendar are kept. Remove them in Google Calendar if you want them gone.</p>
        <p className="text-small font-medium">This cannot be undone.</p>
        <label className="block space-y-2">
          <span className="block text-small font-medium">Type <b>{CONFIRM_DELETE_ACCOUNT}</b> to confirm</span>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} className={fieldClass} spellCheck={false} autoComplete="off" disabled={busy} />
        </label>
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="secondary" loading={busy} disabled={typed !== CONFIRM_DELETE_ACCOUNT || busy} className="border-nofit text-nofit">Delete account and data</Button>
        </div>
      </form>}
    </dialog>
  </>;
}
