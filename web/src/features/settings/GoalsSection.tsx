import { useEffect, useState } from "react";
import { archiveGoal, createGoal, getStarterGoals, reorderGoals, restoreGoal, updateGoal } from "../../api/goals";
import { errorText } from "../../api/errors";
import type { Goal, StarterGoal } from "../../api/types";
import { useAlert } from "../../ui/AlertProvider";
import { goalDotClass } from "../../ui/GoalChip";
import { cx } from "../../ui/cx";
import { GoalEditor, type GoalDraft } from "./GoalEditor";
import { SettingsSection } from "./SettingsSection";
import "./settings.css";

const MAX_ACTIVE = 6;

type Row = Omit<Goal, "metrics"> & { saves: number };

const toRow = (goal: Goal): Row => ({ ...goal, saves: goal.metrics?.importedSaves ?? 0 });
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Goals are the reason a save gets time, so they are managed on their own and changes apply right away.
export function GoalsSection({ goals: initial }: { goals: Goal[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [starters, setStarters] = useState<StarterGoal[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alert = useAlert();

  useEffect(() => {
    let live = true;
    getStarterGoals().then((list) => live && setStarters(list)).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const active = rows.filter((row) => !row.archived).sort((a, b) => a.position - b.position);
  const archived = rows.filter((row) => row.archived);
  const full = active.length >= MAX_ACTIVE;
  const offered = starters.filter((starter) => !rows.some((row) => sameName(row.name, starter.name)));

  async function run(key: string, work: () => Promise<void>, failTitle: string) {
    setBusy(key);
    try {
      await work();
    } catch (cause) {
      alert.error(errorText(cause, "Could not save the change. Try again"), { title: failTitle });
    } finally {
      setBusy(null);
    }
  }

  const patchRow = (updated: Omit<Goal, "metrics">) =>
    setRows((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));

  const add = (draft: GoalDraft) =>
    run("new", async () => {
      const goal = await createGoal({ name: draft.name, description: draft.description.trim() || null });
      setRows((current) => [...current, { ...goal, saves: 0 }]);
      setEditing(null);
    }, "Goal not added");

  const save = (id: number, draft: GoalDraft) =>
    run(`edit-${id}`, async () => {
      patchRow(await updateGoal(id, { name: draft.name, description: draft.description.trim() || null, color: draft.color }));
      setEditing(null);
    }, "Goal not saved");

  const archive = (id: number) =>
    run(`archive-${id}`, async () => patchRow(await archiveGoal(id)), "Goal not archived");

  const restore = (id: number) =>
    run(`restore-${id}`, async () => patchRow(await restoreGoal(id)), "Goal not restored");

  const move = (id: number, direction: -1 | 1) => {
    const ids = active.map((row) => row.id);
    const from = ids.indexOf(id);
    const to = from + direction;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    return run(`move-${id}`, async () => {
      const updated = await reorderGoals(ids);
      setRows((current) => current.map((row) => {
        const next = updated.find((goal) => goal.id === row.id);
        return next ? { ...row, ...next } : row;
      }));
    }, "Goals not reordered");
  };

  return (
    <SettingsSection title="Goals" description="Broad areas your saves are sorted into. Muse reads the descriptions to choose the right one.">
      <p className="st-note" role="status">{active.length} of {MAX_ACTIVE} goals in use</p>
      <ul className="st-goal-list">
        {active.map((goal, index) => (
          <li key={goal.id} className="st-goalrow">
            {editing === goal.id ? (
              <GoalEditor initial={{ name: goal.name, description: goal.description ?? "", color: goal.color }} withColor
                submitLabel="Save goal" busy={busy === `edit-${goal.id}`} onSubmit={(draft) => void save(goal.id, draft)} onCancel={() => setEditing(null)} />
            ) : (
              <>
                <span aria-hidden="true" className={cx("st-goal-dot", goalDotClass(goal.id))} />
                <div className="st-goal-text">
                  <b>{goal.name}</b>
                  <span>{goal.description ?? "No description. Add one to help Muse match saves"}</span>
                  <small>{goal.saves} {goal.saves === 1 ? "save" : "saves"}</small>
                </div>
                <div className="st-goal-tools">
                  <button type="button" className="st-btn" aria-label={`Move ${goal.name} up`} disabled={index === 0 || busy !== null} onClick={() => void move(goal.id, -1)}>↑</button>
                  <button type="button" className="st-btn" aria-label={`Move ${goal.name} down`} disabled={index === active.length - 1 || busy !== null} onClick={() => void move(goal.id, 1)}>↓</button>
                  <button type="button" className="st-btn" onClick={() => setEditing(goal.id)} disabled={busy !== null}>Edit</button>
                  <button type="button" className="st-btn" onClick={() => void archive(goal.id)} disabled={busy !== null || active.length <= 1}
                    title={active.length <= 1 ? "Keep at least one active goal" : undefined}>Archive</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        <div className="st-add">
          {offered.length > 0 && (
            <div>
              <p className="st-label">Start from a general goal</p>
              <div className="st-chips">
                {offered.map((starter) => (
                  <button key={starter.name} type="button" className="st-chip" disabled={busy !== null}
                    onClick={() => void add({ name: starter.name, description: starter.description })}>
                    + {starter.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="st-label">{offered.length > 0 ? "Or write your own" : "Add your own"}</p>
          <GoalEditor initial={{ name: "", description: "" }} submitLabel="Add goal" busy={busy === "new"}
            onSubmit={(draft) => void add(draft)} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        <div className="st-actions">
          <button type="button" className="st-btn st-btn-main" onClick={() => setEditing("new")} disabled={full || busy !== null}>Add a goal</button>
          {full && <span className="st-hint" style={{ margin: 0 }}>Archive a goal to add another</span>}
        </div>
      )}

      {archived.length > 0 && (
        <details className="st-archived">
          <summary>Archived goals ({archived.length})</summary>
          <p className="st-hint">Archived goals keep their saves and history. New saves are not sorted into them.</p>
          <ul className="st-goal-list">
            {archived.map((goal) => (
              <li key={goal.id} className="st-goalrow">
                <span aria-hidden="true" className={cx("st-goal-dot", goalDotClass(goal.id))} />
                <div className="st-goal-text"><b>{goal.name}</b><small>{goal.saves} {goal.saves === 1 ? "save" : "saves"}</small></div>
                <div className="st-goal-tools">
                  <button type="button" className="st-btn" onClick={() => void restore(goal.id)} disabled={full || busy !== null}
                    title={full ? "Archive another goal first" : undefined}>Restore</button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </SettingsSection>
  );
}
