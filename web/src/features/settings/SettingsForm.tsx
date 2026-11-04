import { useState, type FormEvent } from "react";
import { errorText } from "../../api/errors";
import { saveSettings } from "../../api/settings";
import type { Settings } from "../../api/types";
import { useAlert } from "../../ui/AlertProvider";
import { InlineAlert } from "../../ui/InlineAlert";
import { Button } from "../../ui/Button";
import { cx, fieldClass } from "../../ui/cx";
import { SettingsSection } from "./SettingsSection";
import { TimezonePicker } from "./TimezonePicker";

export function SettingsForm({ settings }: { settings: Settings }) {
  const [baseline, setBaseline] = useState(settings);
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  // Validation errors stay inline by the form. Failed saves come from the server and use the popup.
  const [error, setError] = useState<string | null>(null);
  const alert = useAlert();
  const [message, setMessage] = useState<string | null>(null);
  const settingsChanged = JSON.stringify(draft) !== JSON.stringify(baseline);
  const dirty = settingsChanged;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
    setError(null);
  }

  function discard() {
    setDraft(baseline);
    setMessage(null);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (draft.workStart >= draft.workEnd) {
      setError("Working hours must end after they start");
      return;
    }
    if (!draft.tz?.trim()) {
      setError("Choose your timezone");
      return;
    }
    setBusy(true);
    let updated = false;
    try {
      if (settingsChanged) {
        const result = await saveSettings({ ...draft, tz: draft.tz?.trim() || null });
        setBaseline(result);
        setDraft(result);
        updated = true;
      }
      setMessage("Settings saved");
    } catch (cause) {
      alert.error(`${updated ? "Some changes were saved. " : ""}${errorText(cause, "Could not save changes. Try again")}`, { title: "Settings not saved" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
        <SettingsSection title="Working hours" description="Time blocks are only placed inside these hours.">
          <div className="st-grid">
            <label>
              <span className="st-label">Start</span>
              <input required type="time" value={draft.workStart} onChange={(event) => update("workStart", event.target.value)} className={fieldClass} />
            </label>
            <label>
              <span className="st-label">End</span>
              <input required type="text" inputMode="text" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" title="HH:mm, up to 24:00"
                value={draft.workEnd} onChange={(event) => update("workEnd", event.target.value)} className={fieldClass} />
            </label>
          </div>
          <p className="st-hint" style={{ marginTop: 0 }}>Use 24 hour time, with 24:00 for the end of the day</p>
        </SettingsSection>
        <SettingsSection title="Timezone" description="Your working hours and every time shown in the app use this zone.">
          <div>
            <span className="st-label" aria-hidden="true">Timezone</span>
            <TimezonePicker value={draft.tz} onChange={(tz) => update("tz", tz)} describedBy="timezone-hint" />
            <p id="timezone-hint" className="st-hint">Choose from the list or type to search</p>
          </div>
          <label className="st-toggle">
            <div><b>Ignore all-day events</b><span>All-day events do not block time when looking for a slot</span></div>
            <input type="checkbox" role="switch" className="st-switch" checked={draft.ignoreAllDay} onChange={(event) => update("ignoreAllDay", event.target.checked)} />
          </label>
        </SettingsSection>
      </fieldset>
      {error && <InlineAlert className="mt-2">{error}</InlineAlert>}
      <div className="st-savebar">
        <p role="status" className={cx("st-savebar-state", dirty ? "dirty" : message && "saved")}>
          <i aria-hidden="true" />{dirty ? "Unsaved changes" : message ?? "No changes"}
        </p>
        <div className="st-savebar-buttons">
          {dirty && <Button type="button" variant="secondary" onClick={discard} disabled={busy}>Discard</Button>}
          <Button type="submit" loading={busy} disabled={!dirty}>Save settings</Button>
        </div>
      </div>
    </form>
  );
}
