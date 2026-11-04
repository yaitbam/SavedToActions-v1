import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorText } from "../../api/errors";
import { deleteSave } from "../../api/saves";
import { Button } from "../../ui/Button";
import { InlineAlert } from "../../ui/InlineAlert";

interface Props {
  saveId: number;
  // The booked calendar time, or null when nothing is on the calendar.
  booked: string | null;
  disabled?: boolean;
}

// Permanent delete with a clear choice. A booked block is removed from Google Calendar first and the server reads
// back that it is gone. If that fails nothing is deleted, and the user may delete the save but keep the event.
export function DeleteSave({ saveId, booked, disabled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"calendar" | "local" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  async function remove(removeFromCalendar: boolean) {
    setBusy(removeFromCalendar ? "calendar" : "local");
    setError(null);
    try {
      await deleteSave(saveId, removeFromCalendar);
      navigate("/app/saves", { replace: true });
    } catch (cause) {
      setError(errorText(cause));
      setBusy(null);
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  return (
    <div className="flex justify-end">
      <Button variant="text" onClick={() => setOpen(true)} disabled={disabled} className="text-nofit">
        Delete this save
      </Button>
      <dialog
        ref={dialog}
        onClose={close}
        onCancel={(event) => busy && event.preventDefault()}
        aria-labelledby="delete-save-title"
        className="m-auto w-[min(92vw,30rem)] rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-ink/70"
      >
        {open && (
          <div className="space-y-4 p-6">
            <h2 id="delete-save-title" className="font-display text-lg">Delete this save?</h2>
            <p className="text-small text-muted">
              The screenshot and everything extracted from it are removed from SavedToAction. This cannot be undone.
            </p>
            {booked && (
              <p className="rounded-card bg-missing-bg px-4 py-3 text-small">
                It is booked on your calendar: <strong>{booked}</strong>. Deleting also removes that block from Google Calendar,
                then checks that it is gone.
              </p>
            )}
            {error && <InlineAlert>{error}</InlineAlert>}
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={close} disabled={busy !== null}>
                Cancel
              </Button>
              {booked && error && (
                <Button variant="secondary" onClick={() => void remove(false)} loading={busy === "local"} disabled={busy !== null}>
                  Delete save, keep calendar block
                </Button>
              )}
              <Button onClick={() => void remove(Boolean(booked))} loading={busy === "calendar" || (!booked && busy === "local")} disabled={busy !== null}>
                {booked ? "Delete save and calendar block" : "Delete save"}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
