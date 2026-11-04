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
  // The link belongs to the save, not the action. An empty value removes it.
  onLink: (link: string | null) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-small text-muted">{label}</span>
      {children}
    </label>
  );
}

export function EditFields({ action, goals, busy, onPatch, onLink }: Props) {
  const settings = useAsync(getSettings, []);
  const [title, setTitle] = useState(action.title ?? "");
  const [deadline, setDeadline] = useState(action.deadline?.wall ?? "");
  const [link, setLink] = useState(action.link?.url ?? "");
  const tz = action.deadline?.tz ?? settings.data?.tz ?? undefined;

  useEffect(() => setTitle(action.title ?? ""), [action.title]);
  useEffect(() => setDeadline(action.deadline?.wall ?? ""), [action.deadline?.wall]);
  useEffect(() => setLink(action.link?.url ?? ""), [action.link?.url]);

  const saveLink = () => {
    const next = link.trim();
    if (next !== (action.link?.url ?? "")) onLink(next || null);
  };

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
          {goals.filter((goal) => !goal.archived || goal.id === action.goalId).map((goal) => (
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
      <Field label="Link to the post">
        <input
          type="url"
          inputMode="url"
          value={link}
          disabled={busy}
          placeholder="Paste the post link from X, LinkedIn or Instagram"
          onChange={(event) => setLink(event.target.value)}
          onBlur={saveLink}
          className={fieldClass}
        />
        <p className="mt-2 text-small text-muted">Kept so you can open the post later. Muse never reads it.</p>
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
        {action.deadline?.timeAssumed && <p className="mt-2 text-small text-muted">The post gave a date only. End of day (23:59) is assumed until you set a time.</p>}
      </Field>
    </div>
  );
}
