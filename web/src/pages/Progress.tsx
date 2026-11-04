import { getHome } from "../api/home";
import { getInsights } from "../api/insights";
import { useAsync } from "../api/useAsync";
import { GoalMetrics } from "../features/progress/GoalMetrics";
import { Summary } from "../features/progress/Summary";
import { UpcomingDeadlines } from "../features/progress/UpcomingDeadlines";
import { WeeklyChart } from "../features/progress/WeeklyChart";
import "../features/progress/progress.css";
import { ErrorState } from "../ui/ErrorState";
import { Popover } from "../ui/Popover";
import { Skeleton } from "../ui/Skeleton";

// Totals first, then one card per goal, then the weekly trend beside the next deadlines.
export function Progress() {
  const insights = useAsync(getInsights, []);
  const home = useAsync(getHome, []);
  const data = insights.data;

  return (
    <div className="pg-page">
      <header className="pg-head">
        <div>
          {home.data?.now.tz && <p className="home-now">{home.data.now.display} · {home.data.now.tz}</p>}
          <h1 className="text-title">Progress</h1>
          <p className="pg-intro">How many saves became action, per goal and by week.</p>
          <div className="pg-how">
            <Popover label="How we count">
              <p>Action rate is saves you marked done divided by saves imported, per goal. Completions are self reported</p>
              <p className="mt-3">Skipped actions are excluded from missed deadlines. Time scheduled counts active blocks once, excluding superseded or cancelled blocks.</p>
            </Popover>
          </div>
        </div>
      </header>
      {insights.error ? (
        <ErrorState title="Could not load progress" error={insights.error} onRetry={() => void insights.reload()} />
      ) : !data ? (
        <>
          <div className="pg-summary">{[1, 2, 3, 4, 5].map((id) => <Skeleton key={id} className="h-32 rounded-[20px]" />)}</div>
          <div className="pg-goals">{[1, 2, 3].map((id) => <Skeleton key={id} className="h-72 rounded-[22px]" />)}</div>
        </>
      ) : (
        <>
          <Summary totals={data.totals} />
          <div className="pg-goals">
            {data.goals.map((goal) => <GoalMetrics key={goal.id} goal={goal} />)}
          </div>
          {data.totals.demoSaves > 0 && <p className="hm-sub">Imported demo data · {data.totals.demoSaves} demo saves in these records</p>}
        </>
      )}
      {!insights.error && (
        <div className="pg-bento">
          <div className="cell-chart">
            {data ? <WeeklyChart weekly={data.weekly} note={data.seriesNote} /> : <Skeleton className="h-80 rounded-[22px]" />}
          </div>
          <div className="cell-due">
            {home.error ? (
              <ErrorState title="Could not load upcoming deadlines" error={home.error} onRetry={() => void home.reload()} />
            ) : home.data ? <UpcomingDeadlines actions={home.data.upcoming} /> : <Skeleton className="h-80 rounded-[22px]" />}
          </div>
        </div>
      )}
    </div>
  );
}
