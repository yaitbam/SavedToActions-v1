import { useState, type FormEvent } from "react";
import { errorText } from "../../api/errors";
import { renameGoal } from "../../api/goals";
import { saveSettings } from "../../api/settings";
import type { Goal, Settings } from "../../api/types";
import { useAlert } from "../../ui/AlertProvider";
import { InlineAlert } from "../../ui/InlineAlert";
import { Button } from "../../ui/Button";
import { cx, fieldClass } from "../../ui/cx";
import { goalDotClass } from "../../ui/GoalChip";
import { SettingsSection } from "./SettingsSection";
import { TimezonePicker } from "./TimezonePicker";

export function SettingsForm({ settings, goals }: { settings: Settings; goals: Goal[] }) {
  const [baseline, setBaseline] = useState(settings);
  const [savedGoals, setSavedGoals] = useState(goals);
  const [draft, setDraft] = useState(settings);
  const [names, setNames] = useState(() => Object.fromEntries(goals.map((goal) => [goal.id, goal.name])));
  const [busy, setBusy] = useState(false);
  // Validation errors stay inline by the form. Failed saves come from the server and use the popup.
  const [error, setError] = useState<string | null>(null);
  const alert = useAlert();
  const [message, setMessage] = useState<string | null>(null);
  const settingsChanged = JSON.stringify(draft) !== JSON.stringify(baseline);
  const changedGoals = savedGoals.filter((goal) => names[goal.id].trim() !== goal.name);
  const dirty = settingsChanged || changedGoals.length > 0;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
    setError(null);
  }

  function discard() {
    setDraft(baseline);
    setNames(Object.fromEntries(savedGoals.map((goal) => [goal.id, goal.name])));
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
    if (savedGoals.some((goal) => !names[goal.id].trim())) {
      setError("Give each goal a name");
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
      for (const goal of changedGoals) {
        const result = await renameGoal(goal.id, names[goal.id].trim());
        setSavedGoals((current) => current.map((item) => item.id === goal.id ? { ...item, name: result.name } : item));
        setNames((current) => ({ ...current, [goal.id]: result.name }));
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
        <SettingsSection title="Goal names" description="Rename the goals your saves are sorted into.">
          <div className="st-goals">
            {savedGoals.map((goal) => (
              <label key={goal.id} className="st-goal">
                <span aria-hidden className={`size-3 shrink-0 rounded-full ${goalDotClass(goal.id)}`} />
                <span className="sr-only">Goal {goal.id} name</span>
                <input required value={names[goal.id]} onChange={(event) => {
                  setNames((current) => ({ ...current, [goal.id]: event.target.value }));
                  setMessage(null);
                  setError(null);
                }} className={fieldClass} />
              </label>
            ))}
          </div>
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
