import { Link } from "react-router-dom";
import type { HomeSummary } from "../../api/types";
import { Chip } from "../../ui/Chip";
import { DeadlineChip } from "../../ui/DeadlineChip";
import { StatusChip, plannedStatus } from "../../ui/StatusChip";
import "../home/home.css";
import "./progress.css";

export function UpcomingDeadlines({ actions }: { actions: HomeSummary[] }) {
  const deadlines = actions.filter((action) => action.deadline !== null);
  return (
    <section className="hm-card" aria-labelledby="deadlines-title">
      <div className="hm-head">
        <h2 id="deadlines-title">Upcoming deadlines <span className="hm-count">{deadlines.length}</span></h2>
      </div>
      {deadlines.length ? (
        <ul className="pg-list">
          {deadlines.map((action) => (
            <li key={action.id}>
              <Link to={`/app/saves/${action.saveId}`} className="hm-row">
                <div className="hm-row-body">
                  {action.title ? <b>{action.title}</b> : <Chip tone="missing">Missing</Chip>}
                  {action.deadline && <DeadlineChip deadline={action.deadline} />}
                  {action.isDemo && <span className="hm-sub">Imported demo data</span>}
                </div>
                <StatusChip status={action.status === "planned"
                  ? plannedStatus(action.check)
                  : action.status === "open" ? "review" : action.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="pg-empty">No upcoming deadlines</p>}
    </section>
  );
}
