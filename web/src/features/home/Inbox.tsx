import { Link } from "react-router-dom";
import type { HomeRecentSave } from "../../api/types";
import { SaveSummary } from "../../ui/SaveSummary";
import { Thumb } from "../../ui/Thumb";
import "./home.css";

interface Props {
  saves: HomeRecentSave[];
  total: number;
  goalName: (goalId: number | null | undefined) => string | undefined;
}

const VISIBLE = 6;

// Saves that still need a goal or minutes. Each row opens the save to finish it.
export function Inbox({ saves, total, goalName }: Props) {
  return (
    <section className="hm-card" aria-labelledby="inbox-title">
      <div className="hm-head">
        <h2 id="inbox-title">Needs a goal or minutes <span className="hm-count">{total}</span></h2>
        {total > VISIBLE && <Link to="/app/saves" className="hm-link">See all {total}</Link>}
      </div>
      <ul className="hm-rows">
        {saves.slice(0, VISIBLE).map((save) => {
          const action = save.action;
          if (!action) return null;
          return (
            <li key={save.saveId}>
              <Link to={`/app/saves/${save.saveId}`} className="hm-row">
                <div className="hm-row-thumb">
                  <Thumb src={save.screenshotUrl} alt={`Screenshot of ${action.title ?? "a saved post"}`} />
                </div>
                <div className="hm-row-body">
                  <SaveSummary
                    lines={2}
                    title={action.title}
                    goalId={action.goalId}
                    goalName={goalName(action.goalId)}
                    status={null}
                    isDemo={save.isDemo}
                  />
                </div>
                <span className="hm-row-go" aria-hidden="true">Review ›</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
