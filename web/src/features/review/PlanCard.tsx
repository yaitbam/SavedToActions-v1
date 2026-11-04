import { useState } from "react";
import { Link } from "react-router-dom";
import { googleConnectUrl } from "../../api/auth";
import type { Action, Goal } from "../../api/types";
import { Button, buttonClass } from "../../ui/Button";
import { goalDotClass } from "../../ui/GoalChip";
import { Skeleton } from "../../ui/Skeleton";
import { cx, fieldClass } from "../../ui/cx";
import { EffortChips } from "./EffortChips";
import type { Proposal } from "./model";
import { GoogleIcon } from "../../ui/PlatformIcons";
import "./review.css";

interface Props {
  action: Action;
  goals: Goal[];
  minutes: number | null;
  proposal: Proposal | null;
  // Whether the time the note asked for was met. Only present on a first proposal.
  intent: { applied: boolean; label: string | null; reason?: string } | null;
  // Set after "Ask Muse for a different time". It replaces what the note asked for.
  request: { text: string; reason: string } | null;
  busy: string | null;
  needsCalendar: boolean;
  onMinutes: (minutes: number | null) => void;
  onBook: () => void;
  onAnother: () => void;
  onFind: () => void;
  onAsk: (text: string) => void;
  onGoal: (goalId: number) => void;
  onSkip: () => void;
}

const reasonText: Record<string, string> = {
  outside_working_hours: "That is outside your working hours",
  nothing_fits: "Nothing is free then",
  in_the_past: "That time has passed",
};

// The whole decision on one card: a time, the minutes, and one button. Everything else stays out of the way.
export function PlanCard({ action, goals, minutes, proposal, intent, request, busy, needsCalendar, onMinutes, onBook, onAnother, onFind, onAsk, onGoal, onSkip }: Props) {
  const [ask, setAsk] = useState("");
  const working = busy !== null;
  const finding = busy === "propose" || busy === "plan";
  const fromNote = action.intent;
  const noteChips = [fromNote?.label, fromNote?.minutes ? `${fromNote.minutes} min` : null].filter(Boolean) as string[];
  const checks: string[] = [];
  if (action.deadline?.timeAssumed) checks.push(`The post gave a date only, so the deadline is the end of ${action.deadline.short ?? "that day"}`);
  if (!action.deadline) checks.push("No deadline was found, so Muse looks within the next two weeks");

  if (needsCalendar) {
    return (
      <section className="pc" aria-labelledby="pc-title">
        <h2 id="pc-title" className="pc-title">Connect your calendar to see a time</h2>
        <p className="pc-sub">Muse only reads when you are free. Nothing is written until you approve a time.</p>
        <div className="pc-actions">
          <a href={googleConnectUrl} className={buttonClass("primary")}><GoogleIcon />Connect Google Calendar</a>
        </div>
      </section>
    );
  }

  return (
    <section className="pc is-ready" aria-labelledby="pc-title" aria-busy={finding}>
      <header className="pc-head">
        <p className="pc-eyebrow">{proposal ? "Muse suggests" : "Plan it"}</p>
        {request ? (
          <span className="pc-note" title={request.text}>
            <i aria-hidden="true" />From your request: {request.text}
          </span>
        ) : noteChips.length > 0 && (
          <span className="pc-note" title={fromNote?.when?.quote ?? undefined}>
            <i aria-hidden="true" />From your note: {noteChips.join(" · ")}
          </span>
        )}
      </header>

      {finding && !proposal ? (
        <div className="pc-loading" role="status">
          <Skeleton className="h-10 w-3/4" />
          <span className="text-small text-muted">Finding a free time</span>
        </div>
      ) : proposal ? (
        <>
          <h2 id="pc-title" className="pc-time">{proposal.slot.rangeRelative}</h2>
          {request && <p className="pc-intent pc-reason is-met" role="status" title={request.reason}>{request.reason}</p>}
          {!request && intent && (
            <p className={cx("pc-intent", intent.applied ? "is-met" : "is-unmet")} role="status">
              {intent.applied
                ? `Matches your note: ${fromNote?.when?.quote ? `“${fromNote.when.quote}”` : intent.label}`
                : `Nothing fits ${intent.label?.toLowerCase() ?? "then"}${intent.reason && reasonText[intent.reason] ? `. ${reasonText[intent.reason]}` : ""}. This is the next free time.`}
            </p>
          )}
        </>
      ) : (
        <h2 id="pc-title" className="pc-title">{minutes ? "Find a free time" : "How long will this take?"}</h2>
      )}

      <div className="pc-block">
        <span className="pc-label" id="pc-minutes">{minutes ? "How long" : "Pick the minutes and Muse finds a time"}</span>
        <EffortChips minutes={minutes} disabled={working} onChange={onMinutes} />
      </div>

      <div className="pc-actions">
        {proposal ? (
          <Button onClick={onBook} loading={busy === "book"} disabled={working && busy !== "book"}>
            {proposal.mode === "move" ? `Move to ${proposal.slot.startRelative}` : `Add ${minutes ?? proposal.slot.durationMin} min to calendar`}
          </Button>
        ) : (
          <Button onClick={onFind} loading={finding} disabled={!minutes || (working && !finding)}>Find a time</Button>
        )}
        {proposal && (
          <Button variant="secondary" onClick={onAnother} loading={busy === "another"} disabled={working && busy !== "another"}>Another time</Button>
        )}
        <Link to="/app/saves" className={buttonClass("text")}>Later</Link>
        <Button variant="text" onClick={onSkip} disabled={working}>Skip</Button>
      </div>
      {proposal && <p className="pc-fine">You approve it, then it is written to your calendar and read back to check it.</p>}

      {(action.goalId === null || checks.length > 0) && (
        <div className="pc-check" role="group" aria-label="Check this">
          <p className="pc-label">Check this</p>
          {action.goalId === null && (
            <div className="pc-goal">
              <span>Which goal is this for?</span>
              <span className="rv-chips">
                {goals.filter((goal) => !goal.archived).map((goal) => (
                  <button
                    key={goal.id}
                    type="button"
                    disabled={working}
                    onClick={() => onGoal(goal.id)}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-small font-medium hover:border-ink disabled:opacity-60"
                  >
                    <span aria-hidden="true" className={cx("size-2 rounded-full", goalDotClass(goal.id))} />
                    {goal.name}
                  </button>
                ))}
              </span>
            </div>
          )}
          {checks.map((text) => <p key={text} className="pc-checkline">{text}</p>)}
        </div>
      )}

      <details className="pc-ask">
        <summary>Ask Muse for a different time</summary>
        <form
          className="pc-ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (ask.trim() && minutes) onAsk(ask.trim());
          }}
        >
          <input
            value={ask}
            onChange={(event) => setAsk(event.target.value)}
            maxLength={120}
            placeholder="For example: after 6pm, not on Friday"
            aria-label="When would you like it?"
            className={fieldClass}
          />
          <Button type="submit" variant="secondary" loading={busy === "plan"} disabled={!ask.trim() || !minutes || (working && busy !== "plan")}>Ask</Button>
        </form>
        <p className="pc-fine">Uses 1 credit. Muse can only look at your calendar. You still approve the time.</p>
      </details>
    </section>
  );
}
