import type { Action, Goal } from "../../api/types";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { DeadlineChip } from "../../ui/DeadlineChip";
import { GoalChip, goalDotClass } from "../../ui/GoalChip";
import { ModelChip } from "../../ui/ModelChip";
import { PostLinkChip } from "../../ui/PostLinkChip";
import { SourceChip } from "../../ui/SourceChip";
import { cx } from "../../ui/cx";
import { Step } from "./Step";

interface Props {
  action: Action;
  goals: Goal[];
  busy: boolean;
  onGoal: (goalId: number) => void;
  // Saves a deadline the user accepted from a proposal. The server fills in the timezone.
  onDeadline: (wall: string) => void;
  // The page shows the title first, the plan, then what was read. "all" keeps them together.
  part?: "title" | "read" | "all";
  // While planning, the check step is step 1 and carries the way to edit before anything is added.
  step?: { n: number; title: string; hint: string; onEdit: () => void };
}

const kindLabel: Record<string, string> = { try: "Try it", opportunity: "Opportunity" };

// Chip text from the server's correction warning. No offsets are computed here.
function timezoneChipText(action: Action): string | null {
  if (!action.hasTimezoneCorrection) return null;
  const warning = action.warnings.find((item) => item.code === "deadline_offset_ignored");
  const info = warning?.proposed as { modelOffset?: string; computedOffset?: string; tz?: string } | undefined;
  if (!info?.modelOffset || !info.computedOffset || !info.tz) return "Timezone corrected";
  const city = info.tz.split("/").pop()?.replaceAll("_", " ") ?? info.tz;
  return `Model wrote ${info.modelOffset} for ${city}. Corrected to ${info.computedOffset}`;
}

// Why there is no deadline, from the extraction warnings. Nothing is used until the user accepts it.
function missingDeadlineReason(action: Action): { text: string; wall: string | null } | null {
  if (action.deadline) return null;
  const warning = action.warnings.find((item) =>
    item.field === "deadline" && ["deadline_unsupported", "deadline_in_past", "deadline_invalid"].includes(item.code));
  if (!warning) return null;
  const proposed = warning.proposed as { wall?: string | null; date?: string | null } | undefined;
  const wall = proposed?.wall ?? (proposed?.date ? `${proposed.date}T23:59` : null);
  return { text: warning.message ?? "No deadline was set.", wall: warning.code === "deadline_unsupported" ? wall : null };
}

// The title, then step 1: what the model read, with where each field came from. Missing stays Missing.
export function ReviewHeader({ action, goals, busy, onGoal, onDeadline, part = "all", step }: Props) {
  const goal = goals.find((item) => item.id === action.goalId);
  const reason = missingDeadlineReason(action);
  const tzText = timezoneChipText(action);
  const kind = kindLabel[action.kind];

  return (
    <>
      {part !== "read" && (
      <div className="rv-title">
        {action.isDemo && <p className="text-small text-muted">Imported demo data</p>}
        {action.title ? (
          <h1 className="text-title">{action.title}</h1>
        ) : (
          <div className="flex items-center gap-3">
            <h1 className="text-title">Title</h1>
            <Chip tone="missing">Missing</Chip>
          </div>
        )}
        {(kind || action.link) && (
          <div className="rv-chips">
            {kind && <Chip>{kind}</Chip>}
            {action.link && <PostLinkChip link={action.link} />}
          </div>
        )}
      </div>
      )}

      {part !== "title" && (
      <Step n={step?.n} title={step?.title ?? "What Muse read"} hint={step?.hint ?? "Check these against your screenshot"} current={action.goalId === null}>
        <dl className="rv-fields">
          <div>
            <dt>Goal</dt>
            <dd>
              {action.goalId === null ? (
                <span className="rv-ask w-full">
                  <b>Which goal is this for?</b>
                  <span className="rv-chips">
                    {goals.filter((item) => !item.archived).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={busy}
                        onClick={() => onGoal(item.id)}
                        className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-small font-medium hover:border-ink disabled:opacity-60"
                      >
                        <span aria-hidden="true" className={cx("size-2 rounded-full", goalDotClass(item.id))} />
                        {item.name}
                      </button>
                    ))}
                  </span>
                </span>
              ) : (
                <GoalChip goalId={action.goalId} name={goal?.name} />
              )}
            </dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd className="rv-deadline">
              {action.deadline ? (
                <>
                  <DeadlineChip deadline={action.deadline} />
                  {action.deadline.timeAssumed && (
                    <span className="rv-deadline-note">
                      The post gave {action.deadline.display ? "a date only" : "a date"}. End of day is assumed. Change the time in Details if it says otherwise
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Chip tone="missing">Missing</Chip>
                  {reason && (
                    <span className="rv-deadline-note">
                      {reason.text}
                      {reason.wall && (
                        <>
                          {" "}
                          <button type="button" className="rv-deadline-use" disabled={busy} onClick={() => onDeadline(reason.wall as string)}>Use it anyway</button>
                        </>
                      )}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>

        {action.evidence.quote && (
          <div>
            <blockquote className="rv-quote" title={action.evidence.quote}>“{action.evidence.quote}”</blockquote>
            <div className="rv-quote-foot">
              <SourceChip badge={action.evidence.badge} badgeLabel={action.evidence.badgeLabel} />
            </div>
          </div>
        )}

        {(action.model || tzText) && (
          <div className="rv-chips">
            {action.model && <ModelChip ms={action.extractionLatencyMs} model={action.model} />}
            {tzText && <Chip tone="neutral">{tzText}</Chip>}
          </div>
        )}
        {step && (
          <div>
            <Button variant="secondary" onClick={step.onEdit}>Edit title, deadline, goal or link</Button>
          </div>
        )}
      </Step>
      )}
    </>
  );
}
