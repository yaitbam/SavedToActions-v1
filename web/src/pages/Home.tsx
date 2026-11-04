import { Link } from "react-router-dom";
import { AttentionCard } from "../features/home/AttentionCard";
import { ConnectCard } from "../features/home/ConnectCard";
import { GoalRows } from "../features/home/GoalRows";
import { Inbox } from "../features/home/Inbox";
import { inboxSaves, pickNextUp } from "../features/home/model";
import { NextUp } from "../features/home/NextUp";
import { useHomeData } from "../features/home/useHomeData";
import { WeekStrip } from "../features/home/WeekStrip";
import { DropZone } from "../features/newSave/DropZone";
import { Button } from "../ui/Button";
import { ErrorState } from "../ui/ErrorState";
import { Skeleton } from "../ui/Skeleton";

const ATTENTION_VISIBLE = 2;

export function Home() {
  const { home, goals, planned, week, reload, recheck, rechecking, recheckNote } = useHomeData();
  const data = home.data;
  const goalName = (id: number | null | undefined) => goals.data?.find((goal) => goal.id === id)?.name;

  const attention = data?.needs_attention ?? [];
  const inbox = data ? inboxSaves(data) : [];
  const inboxTotal = Math.max(inbox.length, data?.inbox.needs_effort ?? 0);
  const nextUp = data ? pickNextUp(data) : null;
  const plannedItems = planned.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-title">What needs you today</h1>
          {data && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted">
              <span>{data.now.display}</span>
              {data.now.tz && <span>{data.now.tz}</span>}
            </p>
          )}
        </div>
        {data?.google_connected && (
          <div className="flex items-center gap-3">
            {recheckNote && (
              <span role="alert" className="text-small text-nofit">
                {recheckNote}
              </span>
            )}
            <Button variant="secondary" onClick={recheck} loading={rechecking} disabled={plannedItems.length === 0}>
              Recheck now
            </Button>
          </div>
        )}
      </header>

      <DropZone />

      {home.error && !data ? (
        <ErrorState error={home.error} title="Could not load your saves" onRetry={() => void home.reload()} />
      ) : !data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : !data.google_connected ? (
        <ConnectCard />
      ) : data.recent_saves.length === 0 && attention.length === 0 ? (
        <p className="text-muted">Your saved posts are waiting. Drop one to start</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <div className="space-y-6">
            {attention.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-base">Needs you now</h2>
                {attention.slice(0, ATTENTION_VISIBLE).map((item) => (
                  <AttentionCard key={item.action.id} item={item} onChanged={() => void reload()} />
                ))}
                {attention.length > ATTENTION_VISIBLE && (
                  <Link to="/app/saves" className="inline-block text-small font-medium underline underline-offset-4">
                    {attention.length - ATTENTION_VISIBLE} more need you
                  </Link>
                )}
              </section>
            )}
            {nextUp && <NextUp action={nextUp} goalName={goalName(nextUp.goalId)} />}
          </div>

          <div className="space-y-6">
            {goals.data && <GoalRows goals={goals.data} />}
            {inbox.length > 0 && <Inbox saves={inbox} total={inboxTotal} goalName={goalName} />}
            <WeekStrip
              week={week.data}
              planned={plannedItems}
              error={week.error}
              onRetry={() => void week.reload()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
