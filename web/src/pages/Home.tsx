import { useEffect } from "react";
import { Link } from "react-router-dom";
import { getGoalsSetup } from "../api/goals";
import { getTimezoneSetup } from "../api/settings";
import { useAsync } from "../api/useAsync";
import { useSession } from "../features/auth/SessionContext";
import { AttentionCard } from "../features/home/AttentionCard";
import { ConnectCard } from "../features/home/ConnectCard";
import { GoalRows } from "../features/home/GoalRows";
import { GoalsSetup } from "../features/home/GoalsSetup";
import { Inbox } from "../features/home/Inbox";
import { inboxSaves, pickNextUp } from "../features/home/model";
import { NextUp } from "../features/home/NextUp";
import { TimezoneSetup } from "../features/home/TimezoneSetup";
import { NoPlan, Pulse } from "../features/home/Pulse";
import { useHomeData } from "../features/home/useHomeData";
import { WeekStrip } from "../features/home/WeekStrip";
import { DropZone } from "../features/newSave/DropZone";
import { Button } from "../ui/Button";
import { ErrorState } from "../ui/ErrorState";
import { Skeleton } from "../ui/Skeleton";

const ATTENTION_VISIBLE = 3;

// A twelve column bento on the full width canvas. Each cell only renders when it has something to say.
export function Home() {
  const { home, goals, planned, week, reload, recheck, rechecking } = useHomeData();
  const { session } = useSession();
  const setup = useAsync(getGoalsSetup, []);
  const tzSetup = useAsync(getTimezoneSetup, []);
  const data = home.data;
  // Coming back from Google, the address still carries the result. The page already shows it, so tidy the address.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("google")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  // After the calendar is connected, a new user confirms their timezone, then chooses their goals.
  const connected = !!data?.google_connected && session?.kind !== "demo";
  // Until both setup answers are in, show a loader. Otherwise the drop zone or dashboard flashes first
  // and is then swapped for the setup step.
  const checking = !data
    ? !home.error
    : connected && ((tzSetup.loading && !tzSetup.data && !tzSetup.error) || (setup.loading && !setup.data && !setup.error));
  const needsTimezone = connected && tzSetup.data?.done === false;
  const needsGoals = connected && tzSetup.data?.done === true && setup.data?.done === false;
  const goalName = (id: number | null | undefined) => goals.data?.find((goal) => goal.id === id)?.name;

  const attention = data?.needs_attention ?? [];
  const inbox = data ? inboxSaves(data) : [];
  const inboxTotal = Math.max(inbox.length, data?.inbox.needs_effort ?? 0);
  const nextUp = data ? pickNextUp(data) : null;
  const plannedItems = planned.data?.items ?? [];
  const isEmpty = !!data && data.recent_saves.length === 0 && attention.length === 0;

  return (
    <div className="home-page">
      <header className="home-head">
        <div>
          {data && <p className="home-now">{data.now.display}{data.now.tz ? ` · ${data.now.tz}` : ""}</p>}
          <h1 className="text-title">What needs you today</h1>
        </div>
        {data?.google_connected && (
          <Button variant="secondary" onClick={recheck} loading={rechecking} disabled={plannedItems.length === 0}>
            Recheck now
          </Button>
        )}
      </header>

      {data && !data.google_connected && <ConnectCard />}
      {!data && !home.error ? null : checking ? (
        <Skeleton className="h-72 rounded-[28px]" />
      ) : needsTimezone ? (
        <TimezoneSetup current={tzSetup.data?.tz ?? null} onDone={() => void Promise.all([tzSetup.reload(), reload()])} />
      ) : needsGoals ? (
        <GoalsSetup onDone={() => void Promise.all([setup.reload(), reload()])} />
      ) : (
        <DropZone rich={isEmpty} />
      )}

      {home.error && !data ? (
        <ErrorState error={home.error} title="Could not load your saves" onRetry={() => void home.reload()} />
      ) : !data ? (
        <div className="home-bento">
          <Skeleton className="cell-next h-56" />
          <Skeleton className="cell-goals h-56" />
        </div>
      ) : !data.google_connected || isEmpty || checking || needsTimezone || needsGoals ? null : (
        <>
        <Pulse planned={plannedItems.length} attention={attention.length} toConfirm={inboxTotal} />
        <div className="home-bento">
          {nextUp && <div className="cell-next"><NextUp action={nextUp} goalName={goalName(nextUp.goalId)} /></div>}
          {goals.data && <div className="cell-goals"><GoalRows goals={goals.data} /></div>}
          {attention.length > 0 && (
            <section className="cell-attn space-y-3">
              <div className="hm-head"><h2>Needs you now <span className="hm-count">{attention.length}</span></h2></div>
              {attention.slice(0, ATTENTION_VISIBLE).map((item) => (
                <AttentionCard key={item.action.id} item={item} onChanged={() => void reload()} />
              ))}
              {attention.length > ATTENTION_VISIBLE && (
                <Link to="/app/saves" className="hm-link inline-block">
                  {attention.length - ATTENTION_VISIBLE} more need you
                </Link>
              )}
            </section>
          )}
          <div className="cell-week">
            {planned.data && plannedItems.length === 0
              ? <NoPlan />
              : <WeekStrip week={week.data} planned={plannedItems} error={week.error} onRetry={() => void week.reload()} />}
          </div>
          {inbox.length > 0 && <div className="cell-inbox"><Inbox saves={inbox} total={inboxTotal} goalName={goalName} /></div>}
        </div>
        </>
      )}
    </div>
  );
}
