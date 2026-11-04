import { Link } from "react-router-dom";
import type { HomeSummary } from "../../api/types";
import { SaveSummary } from "../../ui/SaveSummary";
import { Thumb } from "../../ui/Thumb";
import { summaryStatus } from "./model";
import "./home.css";

interface Props {
  action: HomeSummary;
  goalName?: string;
}

// The next planned block. The whole card opens the save. The time comes from the server as a display string.
export function NextUp({ action, goalName }: Props) {
  return (
    <section className="hm-card" aria-labelledby="next-title">
      <div className="hm-head">
        <h2 id="next-title">Next up</h2>
        <Link to={`/app/saves/${action.saveId}`} className="hm-link">Open</Link>
      </div>
      <Link to={`/app/saves/${action.saveId}`} className="hm-next">
        <div className="w-24 shrink-0">
          <Thumb src={action.screenshotUrl} alt={`Screenshot of ${action.title ?? "a saved post"}`} />
        </div>
        <div className="min-w-0 flex-1">
          {action.block && <p className="hm-next-time">{action.block.rangeRelative}</p>}
          <SaveSummary
            title={action.title}
            goalId={action.goalId}
            goalName={goalName}
            status={summaryStatus(action)}
            isDemo={action.isDemo}
          />
        </div>
      </Link>
    </section>
  );
}
