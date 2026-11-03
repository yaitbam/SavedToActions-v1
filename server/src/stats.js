// Goal metrics, computed from database records only, with the exact definitions from the project brief.
// Nothing here is estimated or invented. Completions are self reported. A higher action rate does not
// mean more value, so the UI must not imply that.
import { scheduledMinutes } from "./scheduler/blocks.js";
import { toIso } from "./scheduler/time.js";

export const METRIC_DEFINITIONS = Object.freeze({
  importedSaves: "Distinct saves that have an action in this goal. A save whose extraction failed has no action and no goal yet, so it is not counted.",
  demoSaves: "Of the imported saves, how many are imported demo history (is_demo).",
  planned: "Actions with status planned that have an active approved block (not superseded, not cancelled).",
  markedDone: "Actions the user marked done. Self reported.",
  savesWithDoneAction: "Distinct saves that have at least one done action.",
  deadlinePassedWithoutCompletion: "Actions that are still open or planned and whose deadline is at or before now. Skipped actions are excluded. Done actions are excluded. A deadline that could not be resolved to a UTC instant is not counted.",
  actionRate: "Distinct saves with a done action divided by distinct imported saves in the same goal. Null when the goal has no imported saves.",
  timeScheduledMin: "Sum of the minutes of active, non superseded, non cancelled blocks. This is time put on the calendar, not time invested.",
});

/** Map of goal id to metrics. Goals with no records get zeros and a null action rate. */
export function goalMetrics(db, nowMs) {
  const nowIso = toIso(nowMs);
  const count = (sql, ...params) => new Map(db.prepare(sql).all(...params).map((r) => [r.goal_id, r.n]));

  const importedSaves = count("SELECT goal_id, COUNT(DISTINCT save_id) AS n FROM actions WHERE goal_id IS NOT NULL GROUP BY goal_id");
  const demoSaves = count(
    `SELECT a.goal_id AS goal_id, COUNT(DISTINCT a.save_id) AS n
     FROM actions a JOIN saves s ON s.id = a.save_id
     WHERE a.goal_id IS NOT NULL AND s.is_demo = 1 GROUP BY a.goal_id`,
  );
  const planned = count(
    `SELECT goal_id, COUNT(*) AS n FROM actions a
     WHERE goal_id IS NOT NULL AND status = 'planned'
       AND EXISTS (SELECT 1 FROM blocks b WHERE b.action_id = a.id AND b.superseded_by IS NULL AND b.cancelled_at IS NULL)
     GROUP BY goal_id`,
  );
  const markedDone = count("SELECT goal_id, COUNT(*) AS n FROM actions WHERE goal_id IS NOT NULL AND status = 'done' GROUP BY goal_id");
  const doneSaves = count("SELECT goal_id, COUNT(DISTINCT save_id) AS n FROM actions WHERE goal_id IS NOT NULL AND status = 'done' GROUP BY goal_id");
  const missed = count(
    `SELECT goal_id, COUNT(*) AS n FROM actions
     WHERE goal_id IS NOT NULL AND status IN ('open', 'planned') AND deadline_utc IS NOT NULL AND deadline_utc <= ?
     GROUP BY goal_id`,
    nowIso,
  );

  const blocksByGoal = new Map();
  const blockRows = db
    .prepare(
      `SELECT a.goal_id AS goal_id, b.start_utc, b.end_utc, b.superseded_by, b.cancelled_at
       FROM blocks b JOIN actions a ON a.id = b.action_id WHERE a.goal_id IS NOT NULL`,
    )
    .all();
  for (const row of blockRows) {
    if (!blocksByGoal.has(row.goal_id)) blocksByGoal.set(row.goal_id, []);
    blocksByGoal.get(row.goal_id).push(row);
  }

  const out = new Map();
  for (const { id } of db.prepare("SELECT id FROM goals").all()) {
    const imported = importedSaves.get(id) ?? 0;
    const withDone = doneSaves.get(id) ?? 0;
    out.set(id, {
      importedSaves: imported,
      demoSaves: demoSaves.get(id) ?? 0,
      planned: planned.get(id) ?? 0,
      markedDone: markedDone.get(id) ?? 0,
      savesWithDoneAction: withDone,
      deadlinePassedWithoutCompletion: missed.get(id) ?? 0,
      actionRate: imported > 0 ? withDone / imported : null,
      timeScheduledMin: scheduledMinutes(blocksByGoal.get(id) ?? []),
    });
  }
  return out;
}
