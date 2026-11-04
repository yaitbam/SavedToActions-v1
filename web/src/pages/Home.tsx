import { getGoals } from "../api/goals";
import { getHome } from "../api/home";
import type { HomeSummary } from "../api/types";
import { useAsync } from "../api/useAsync";
import { DropZone } from "../features/newSave/DropZone";
import { ErrorState } from "../ui/ErrorState";
import { SaveCard } from "../ui/SaveCard";
import { Skeleton } from "../ui/Skeleton";
import { statusFromCheck, type StatusKey } from "../ui/StatusChip";

function cardStatus(action: HomeSummary | null): StatusKey | null {
  if (!action) return "error";
  if (action.status === "done") return "done";
  if (action.status === "skipped") return null;
  if (action.status === "planned") return action.check ? statusFromCheck(action.check.state) : "planned";
  return action.effort.confirmed ? null : "needs_input";
}

export function Home() {
  const home = useAsync(getHome, []);
  const goals = useAsync(getGoals, []);
  const saves = home.data?.recent_saves ?? [];
  const goalName = (id: number | null | undefined) => goals.data?.find((goal) => goal.id === id)?.name;

  return (
    <div className="space-y-6">
      <h1 className="text-title">What needs you today</h1>
      <DropZone />

      {home.error && !home.data ? (
        <ErrorState error={home.error} title="Could not load your saves" onRetry={() => void home.reload()} />
      ) : !home.data ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="aspect-[4/5]" />
          ))}
        </div>
      ) : saves.length === 0 ? (
        <p className="text-muted">Your saved posts are waiting. Drop one to start</p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {saves.map((save) => (
            <li key={save.saveId}>
              <SaveCard
                saveId={save.saveId}
                screenshotUrl={save.screenshotUrl}
                title={save.action?.title ?? null}
                goalId={save.action?.goalId ?? null}
                goalName={goalName(save.action?.goalId)}
                status={cardStatus(save.action)}
                when={save.importedAtRelative}
                demo={save.isDemo}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
