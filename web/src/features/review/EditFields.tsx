import { useEffect, useState, type ReactNode } from "react";
import { getSettings } from "../../api/settings";
import type { Action, ActionPatch, Goal } from "../../api/types";
import { useAsync } from "../../api/useAsync";
import { fieldClass } from "../../ui/cx";

interface Props {
  action: Action;
  goals: Goal[];
  busy: boolean;
  onPatch: (changes: ActionPatch) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-small text-muted">{label}</span>
      {children}
    </label>
  );
}

export function EditFields({ action, goals, busy, onPatch }: Props) {
  const settings = useAsync(getSettings, []);
  const [title, setTitle] = useState(action.title ?? "");
  const [deadline, setDeadline] = useState(action.deadline?.wall ?? "");
  const tz = action.deadline?.tz ?? settings.data?.tz ?? undefined;

  useEffect(() => setTitle(action.title ?? ""), [action.title]);
  useEffect(() => setDeadline(action.deadline?.wall ?? ""), [action.deadline?.wall]);

  const saveTitle = () => {
    const next = title.trim();
    if (next && next !== action.title) onPatch({ title: next });
  };

  const saveDeadline = () => {
    if (deadline === (action.deadline?.wall ?? "")) return;
    onPatch({ deadline: deadline ? { wall: deadline, tz } : null });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Title">
        <input
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          className={fieldClass}
        />
      </Field>
      <Field label="Goal">
        <select
          value={action.goalId ?? ""}
          disabled={busy}
          onChange={(event) => onPatch({ goalId: Number(event.target.value) })}
          className={fieldClass}
        >
          {action.goalId === null && (
            <option value="" disabled>
              Choose a goal
            </option>
          )}
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Type">
        <select
          value={action.kind}
          disabled={busy}
          onChange={(event) => onPatch({ kind: event.target.value as Action["kind"] })}
          className={fieldClass}
        >
          <option value="try">Try it</option>
          <option value="opportunity">Opportunity</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label={tz ? `Deadline (${tz})` : "Deadline"}>
        <input
          type="datetime-local"
          value={deadline}
          disabled={busy}
          onChange={(event) => setDeadline(event.target.value)}
          onBlur={saveDeadline}
          className={fieldClass}
        />
      </Field>
    </div>
  );
}
