import type { Goal } from "../../api/types";
import { Chip } from "../../ui/Chip";
import { goalDotClass } from "../../ui/GoalChip";
import { cx } from "../../ui/cx";
import "../home/home.css";
import "./progress.css";

// One card per goal. The bar and the rate come from database records: saves with a done action over saves imported.
export function GoalMetrics({ goal }: { goal: Goal }) {
  const m = goal.metrics;
  const share = m.importedSaves > 0 ? Math.min(100, (m.savesWithDoneAction / m.importedSaves) * 100) : 0;
  const titleId = `goal-${goal.id}-title`;

  return (
    <section className="hm-card" aria-labelledby={titleId}>
      <div className="hm-head">
        <span id={titleId} className="hm-goal-name">
          <span aria-hidden="true" className={cx("size-3 shrink-0 rounded-full", goalDotClass(goal.id))} />
          <span>{goal.name}</span>
        </span>
        <span className="pg-goal-rate">
          {m.actionRate === null ? <Chip tone="missing">Missing</Chip> : `${Math.round(m.actionRate * 100)}%`}
        </span>
      </div>
      <div className="hm-bar" aria-hidden="true">
        <div className={goalDotClass(goal.id)} style={{ width: `${share}%` }} />
      </div>
      <p className="pg-goal-caption">
        {m.importedSaves > 0 ? `${m.savesWithDoneAction} of ${m.importedSaves} saves done · action rate` : "No saves yet · action rate"}
      </p>
      <dl className="pg-metrics">
        <div><dt>Imported saves</dt><dd>{m.importedSaves}</dd></div>
        <div><dt>Planned</dt><dd>{m.planned}</dd></div>
        <div><dt>Marked done</dt><dd>{m.markedDone}</dd></div>
        <div><dt>Time scheduled</dt><dd>{m.timeScheduledMin} <small>min</small></dd></div>
        <div className="col-span-2"><dt>Deadline passed without completion</dt><dd>{m.deadlinePassedWithoutCompletion}</dd></div>
      </dl>
      {m.demoSaves > 0 && <p className="hm-sub">Imported demo data · {m.demoSaves} saves</p>}
    </section>
  );
}
