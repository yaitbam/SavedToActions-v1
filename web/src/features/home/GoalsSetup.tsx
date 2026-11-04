import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api/errors";
import { getStarterGoals, setupGoals } from "../../api/goals";
import type { StarterGoal } from "../../api/types";
import { useAlert } from "../../ui/AlertProvider";
import { Button } from "../../ui/Button";
import { cx, fieldClass } from "../../ui/cx";
import "./goals-setup.css";

const MAX_GOALS = 6;
const NAME_MAX = 40;
const DESCRIPTION_MAX = 120;
// What a new workspace already has. Pre selected, so one click keeps the usual starting point.
const DEFAULT_PICKS = ["Earn more", "Learn a skill", "Events and opportunities"];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Props {
  onDone: () => void;
}

// Shown on Overview once the calendar is connected, until the user picks their goals or skips.
export function GoalsSetup({ onDone }: Props) {
  const [starters, setStarters] = useState<StarterGoal[]>([]);
  const [custom, setCustom] = useState<StarterGoal[]>([]);
  const [picked, setPicked] = useState<string[]>(DEFAULT_PICKS);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const alert = useAlert();

  useEffect(() => {
    let live = true;
    getStarterGoals().then((list) => live && setStarters(list)).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const options = [...starters, ...custom];
  const chosen = options.filter((goal) => picked.some((name) => sameName(name, goal.name)));
  const full = chosen.length >= MAX_GOALS;
  const draftName = draft.name.trim();
  const draftTaken = options.some((goal) => sameName(goal.name, draftName));

  function toggle(goal: StarterGoal) {
    setPicked((current) => current.some((name) => sameName(name, goal.name))
      ? current.filter((name) => !sameName(name, goal.name))
      : [...current, goal.name]);
  }

  function addCustom(event: FormEvent) {
    event.preventDefault();
    if (!draftName || draftTaken || full) return;
    setCustom((current) => [...current, { name: draftName, description: draft.description.trim() }]);
    setPicked((current) => [...current, draftName]);
    setDraft({ name: "", description: "" });
    setAdding(false);
  }

  async function finish(kind: "save" | "skip") {
    setBusy(kind);
    try {
      await setupGoals(kind === "skip" ? { skip: true } : { goals: chosen });
      onDone();
    } catch (cause) {
      alert.error(errorText(cause, "Could not save your goals. Try again"), { title: "Goals not saved" });
      setBusy(null);
    }
  }

  return (
    <section className="gs" aria-labelledby="gs-title">
      <div className="gs-head">
        <p className="gs-step">Last step</p>
        <h2 id="gs-title">What do you save posts for?</h2>
        <p>
          Muse sorts every screenshot into one of your goals, and your goals decide what gets time on your calendar.
          Pick the ones that fit. You can change them any time in Settings.
        </p>
      </div>

      <ul className="gs-grid" aria-label="Goals">
        {options.map((goal) => {
          const on = chosen.some((item) => sameName(item.name, goal.name));
          return (
            <li key={goal.name}>
              <button type="button" className={cx("gs-card", on && "is-on")} aria-pressed={on} disabled={busy !== null || (!on && full)} onClick={() => toggle(goal)}>
                <span className="gs-check" aria-hidden="true">{on ? "✓" : ""}</span>
                <span className="gs-text">
                  <b>{goal.name}</b>
                  {goal.description && <span>{goal.description}</span>}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          {adding ? (
            <form className="gs-add" onSubmit={addCustom}>
              <input required autoFocus maxLength={NAME_MAX} value={draft.name} placeholder="Your own goal" aria-label="Goal name" className={fieldClass}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              <input maxLength={DESCRIPTION_MAX} value={draft.description} placeholder="A few words that describe it" aria-label="Goal description" className={fieldClass}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              {draftTaken && <p className="gs-error" role="alert">You already have a goal with this name</p>}
              <div className="gs-add-actions">
                <Button type="submit" disabled={!draftName || draftTaken || full}>Add</Button>
                <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <button type="button" className="gs-card gs-new" disabled={busy !== null || full} onClick={() => setAdding(true)}>
              <span className="gs-check" aria-hidden="true">+</span>
              <span className="gs-text"><b>Write your own</b><span>Anything specific to you</span></span>
            </button>
          )}
        </li>
      </ul>

      <div className="gs-foot">
        <p role="status">{chosen.length} of {MAX_GOALS} chosen{chosen.length < 2 ? ". Two or more works best" : ""}</p>
        <div className="gs-actions">
          <Button type="button" variant="text" onClick={() => void finish("skip")} loading={busy === "skip"} disabled={busy !== null}>Skip for now</Button>
          <Button type="button" onClick={() => void finish("save")} loading={busy === "save"} disabled={busy !== null || chosen.length === 0}>Save my goals</Button>
        </div>
      </div>
    </section>
  );
}
