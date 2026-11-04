import { Link } from "react-router-dom";
import type { Goal } from "../../api/types";
import { goalDotClass } from "../../ui/GoalChip";
import { cx } from "../../ui/cx";
import "./home.css";

// A compact view of saves done over saves imported. The full breakdown and how we count live on Progress.
export function GoalRows({ goals }: { goals: Goal[] }) {
  return (
    <section className="hm-card" aria-labelledby="goals-title">
      <div className="hm-head">
        <h2 id="goals-title">Goals</h2>
        <Link to="/app/progress" className="hm-link">See full progress</Link>
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
