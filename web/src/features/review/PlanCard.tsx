import { useState } from "react";
import { Link } from "react-router-dom";
import { googleConnectUrl } from "../../api/auth";
import type { Action } from "../../api/types";
import { Button, buttonClass } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { cx, fieldClass } from "../../ui/cx";
import { EffortChips } from "./EffortChips";
import type { Proposal } from "./model";
import { GoogleIcon } from "../../ui/PlatformIcons";
import "./review.css";

interface Props {
  action: Action;
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
  onSkip: () => void;
  // The block was just taken off the calendar. The save stays open.
  removed: boolean;
}

const reasonText: Record<string, string> = {
  outside_working_hours: "That is outside your working hours",
  nothing_fits: "Nothing is free then",
  in_the_past: "That time has passed",
};

// The whole decision on one card: a time, the minutes, and one button. Everything else stays out of the way.
export function PlanCard({ action, minutes, proposal, intent, request, busy, needsCalendar, onMinutes, onBook, onAnother, onFind, onAsk, onSkip, removed }: Props) {
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
        <p className="pc-eyebrow" id="pc-title">Add it to your calendar</p>
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

      {removed && <p className="pc-intent is-met" role="status">Removed from your calendar. It is still in Saved. Plan it again whenever you like.</p>}

      <div className="pc-block">
        <p className="pc-step"><span className="rv-n" aria-hidden="true">2</span><span className="pc-label" id="pc-minutes">How long will it take?</span></p>
        <EffortChips minutes={minutes} disabled={working} onChange={onMinutes} />
      </div>

      <div className="pc-block">
        <p className="pc-step"><span className="rv-n" aria-hidden="true">3</span><span className="pc-label">Pick a time</span></p>
        {finding && !proposal ? (
          <div className="pc-loading" role="status">
            <Skeleton className="h-10 w-3/4" />
            <span className="text-small text-muted">Finding a free time</span>
          </div>
        ) : proposal ? (
          <>
            <h2 className="pc-time">{proposal.slot.rangeRelative}</h2>
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
          <p className="pc-sub">{minutes ? "Muse finds a free time on your calendar. Nothing is written until you approve." : "Pick the minutes first, then Muse finds a time."}</p>
        )}
      </div>

      {checks.length > 0 && (
        <div className="pc-check" role="group" aria-label="Check this">
          <p className="pc-label">Check this</p>
          {checks.map((text) => <p key={text} className="pc-checkline">{text}</p>)}
        </div>
      )}

      <div className="pc-actions">
        {proposal ? (
          <Button onClick={onBook} loading={busy === "book"} disabled={working && busy !== "book"}>
            {proposal.mode === "move" ? `Move to ${proposal.slot.startRelative}` : `Add ${minutes ?? proposal.slot.durationMin} min to calendar`}
          </Button>
        ) : (
          <Button onClick={onFind} loading={finding} disabled={!minutes || (working && !finding)}>Find a time</Button>
        )}
      </div>
      {proposal && <p className="pc-fine">You approve it, then it is written to your calendar and read back to check it. Need to change something first? Edit the details above.</p>}

      <details className="pc-more">
        <summary>More options</summary>
        <div className="pc-more-body">
          {proposal && (
            <Button variant="secondary" onClick={onAnother} loading={busy === "another"} disabled={working && busy !== "another"}>Show another time</Button>
          )}
          <div className="pc-ask">
            <p className="pc-label">Or ask Muse for a different time</p>
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
          </div>
          <div className="pc-later">
            <Link to="/app/saves" className={buttonClass("text")}>Decide later</Link>
            <Button variant="text" onClick={onSkip} disabled={working}>Skip this save</Button>
          </div>
        </div>
      </details>
    </section>
  );
}
