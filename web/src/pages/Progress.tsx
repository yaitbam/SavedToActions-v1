import { getHome } from "../api/home";
import { getInsights } from "../api/insights";
import { useAsync } from "../api/useAsync";
import { GoalMetrics } from "../features/progress/GoalMetrics";
import { UpcomingDeadlines } from "../features/progress/UpcomingDeadlines";
import { WeeklyChart } from "../features/progress/WeeklyChart";
import { ErrorState } from "../ui/ErrorState";
import { Popover } from "../ui/Popover";
import { Skeleton } from "../ui/Skeleton";

export function Progress() {
  const insights = useAsync(getInsights, []);
  const home = useAsync(getHome, []);
  const data = insights.data;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-title">Progress</h1>
        {home.data?.now.tz && <p className="text-small text-muted">{home.data.now.tz}</p>}
        <Popover label="How we count">
          <p>Action rate is saves you marked done divided by saves imported, per goal. Completions are self reported</p>
          <p className="mt-3">Skipped actions are excluded from missed deadlines. Time scheduled counts active blocks once, excluding superseded or cancelled blocks.</p>
        </Popover>
      </header>
      {insights.error ? (
        <ErrorState title="Could not load progress" error={insights.error} onRetry={() => void insights.reload()} />
      ) : !data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((id) => <Skeleton key={id} className="h-64" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {data.goals.map((goal) => <GoalMetrics key={goal.id} goal={goal} />)}
          </div>
          {data.totals.demoSaves > 0 && <p className="text-small text-muted">Imported demo data · {data.totals.demoSaves} demo saves in these records</p>}
          <WeeklyChart weekly={data.weekly} note={data.seriesNote} />
        </>
      )}
      {home.error ? (
        <ErrorState title="Could not load upcoming deadlines" error={home.error} onRetry={() => void home.reload()} />
      ) : home.data ? <UpcomingDeadlines actions={home.data.upcoming} /> : <Skeleton className="h-28" />}
    </div>
  );
}
