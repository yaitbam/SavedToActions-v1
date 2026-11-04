import { useState, type FormEvent } from "react";
import { errorText } from "../../api/errors";
import { renameGoal } from "../../api/goals";
import { saveSettings } from "../../api/settings";
import type { Goal, Settings } from "../../api/types";
import { useAlert } from "../../ui/AlertProvider";
import { InlineAlert } from "../../ui/InlineAlert";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { fieldClass } from "../../ui/cx";
import { goalDotClass } from "../../ui/GoalChip";

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

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (draft.workStart >= draft.workEnd) {
      setError("Working hours must end after they start");
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
    <form onSubmit={(event) => void save(event)} className="space-y-6">
      <fieldset disabled={busy} className="space-y-6">
        <Card className="space-y-4">
          <h2 className="text-base">Working hours</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="block text-small font-medium">Start</span>
              <input required type="time" value={draft.workStart} onChange={(event) => update("workStart", event.target.value)} className={fieldClass} />
            </label>
            <label className="space-y-2">
              <span className="block text-small font-medium">End</span>
              <input required type="text" inputMode="text" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" title="HH:mm, up to 24:00"
                value={draft.workEnd} onChange={(event) => update("workEnd", event.target.value)} className={fieldClass} />
            </label>
          </div>
          <p className="text-small text-muted">Use 24 hour time, with 24:00 for the end of the day</p>
        </Card>
        <Card className="space-y-4">
          <h2 className="text-base">Timezone and availability</h2>
          <label className="block space-y-2">
            <span className="block text-small font-medium">Timezone</span>
            <input required type="text" value={draft.tz ?? ""} placeholder="Missing" spellCheck={false}
              onChange={(event) => update("tz", event.target.value)} className={fieldClass} aria-describedby="timezone-hint" />
          </label>
          <p id="timezone-hint" className="text-small text-muted">Use an IANA timezone, such as Africa/Casablanca</p>
          <label className="flex items-center gap-3 text-small font-medium">
            <input type="checkbox" checked={draft.ignoreAllDay} onChange={(event) => update("ignoreAllDay", event.target.checked)}
              className="size-5 accent-ink" />
            Ignore all-day events
          </label>
        </Card>
        <Card className="space-y-4">
          <h2 className="text-base">Goal names</h2>
          {savedGoals.map((goal) => (
            <label key={goal.id} className="flex items-center gap-3">
              <span aria-hidden className={`size-3 shrink-0 rounded-full ${goalDotClass(goal.id)}`} />
              <span className="sr-only">Goal {goal.id} name</span>
              <input required value={names[goal.id]} onChange={(event) => {
                setNames((current) => ({ ...current, [goal.id]: event.target.value }));
                setMessage(null);
                setError(null);
              }} className={fieldClass} />
            </label>
          ))}
        </Card>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={busy} disabled={!dirty}>Save settings</Button>
        {message && <p role="status" className="text-small text-fits">{message}</p>}
        {error && <InlineAlert className="w-full">{error}</InlineAlert>}
      </div>
    </form>
  );
}
