import type { Goal } from "../../api/types";
import { goalDotClass } from "../../ui/GoalChip";
import { Popover } from "../../ui/Popover";
import { cx } from "../../ui/cx";
import "./home.css";

// Counts come from database records: saves with a done action, over saves imported.
export function GoalRows({ goals }: { goals: Goal[] }) {
  return (
    <section className="hm-card" aria-labelledby="goals-title">
      <div className="hm-head">
        <h2 id="goals-title">Goals</h2>
        <Popover label="How we count">
          Action rate is saves you marked done divided by saves imported, per goal. Completions are self reported
        </Popover>
      </div>
      <ul className="hm-goals">
        {goals.map((goal) => {
          const { savesWithDoneAction: done, importedSaves: saved } = goal.metrics;
          const share = saved > 0 ? Math.min(100, (done / saved) * 100) : 0;
          return (
            <li key={goal.id}>
              <div className="hm-goal-top">
                <span className="hm-goal-name">
                  <span aria-hidden="true" className={cx("size-3 shrink-0 rounded-full", goalDotClass(goal.id))} />
                  <span>{goal.name}</span>
                </span>
                <span className="hm-goal-num">{saved > 0 ? <><b>{done}</b> of {saved} done</> : "No saves yet"}</span>
              </div>
              <div className="hm-bar" aria-hidden="true">
                <div className={goalDotClass(goal.id)} style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
