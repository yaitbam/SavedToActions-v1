import { useState, type FormEvent } from "react";
import { Button } from "../../ui/Button";
import { colorDotClass, GOAL_COLOR_CLASSES } from "../../ui/GoalChip";
import { cx, fieldClass } from "../../ui/cx";
import "./settings.css";

export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 120;

export interface GoalDraft {
  name: string;
  description: string;
  color?: number;
}

interface Props {
  initial: GoalDraft;
  // Without a color, the swatches are hidden and the server picks the next free one.
  withColor?: boolean;
  submitLabel: string;
  busy: boolean;
  onSubmit: (draft: GoalDraft) => void;
  onCancel: () => void;
}

// One form for adding and editing a goal. A clear description is what helps Muse sort saves into the right goal.
export function GoalEditor({ initial, withColor = false, submitLabel, busy, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState(initial);
  const name = draft.name.trim();
  const changed = draft.name !== initial.name || draft.description !== initial.description || draft.color !== initial.color;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name) onSubmit({ ...draft, name });
  }

  return (
    <form className="st-editor" onSubmit={submit}>
      <label>
        <span className="st-label">Name</span>
        <input required autoFocus maxLength={NAME_MAX} value={draft.name} placeholder="For example Health and wellbeing"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={fieldClass} />
      </label>
      <label>
        <span className="st-label">Description</span>
        <input maxLength={DESCRIPTION_MAX} value={draft.description} placeholder="Fitness, nutrition, sleep, mental health"
          onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={fieldClass} aria-describedby="goal-description-hint" />
        <p id="goal-description-hint" className="st-hint">
          A clear description helps Muse sort your saves into the right goal. {draft.description.length}/{DESCRIPTION_MAX}
        </p>
      </label>
      {withColor && draft.color !== undefined && (
        <fieldset className="st-swatches">
          <legend className="st-label">Color</legend>
          {GOAL_COLOR_CLASSES.map((_, slot) => (
            <label key={slot} className="st-swatch">
              <input type="radio" name="goal-color" className="sr-only" checked={draft.color === slot} onChange={() => setDraft({ ...draft, color: slot })} />
              <span aria-hidden="true" className={cx("st-swatch-dot", colorDotClass(slot))} />
              <span className="sr-only">Color {slot + 1}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="st-actions">
        <Button type="submit" loading={busy} disabled={!name || !changed}>{submitLabel}</Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}
