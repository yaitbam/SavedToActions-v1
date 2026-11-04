import { useState } from "react";
import { Link } from "react-router-dom";
import type { SaveListItem } from "../../api/types";
import { cx } from "../../ui/cx";
import { shortDeadline } from "../../ui/DeadlineChip";
import { GoalChip } from "../../ui/GoalChip";
import { StatusChip } from "../../ui/StatusChip";
import { saveCtaLabel, saveStatus } from "./model";

const PREVIEW_MAX = 280;

// Deadline and effort come from the server record. Missing stays Missing.
export function DeadlineBadge({ save }: { save: SaveListItem }) {
  const deadline = save.action?.deadline;
  if (!deadline) return <span className="deadline-badge none">Deadline: Missing</span>;
  return <span className="deadline-badge" title={deadline.display ?? undefined}>Due {shortDeadline(deadline)}</span>;
}

export function EffortPill({ save }: { save: SaveListItem }) {
  const effort = save.action?.effort;
  const minutes = effort?.confirmedMin ?? effort?.suggestedMin ?? null;
  if (minutes === null) return <span className="effort-pill none">Effort: Missing</span>;
  return <span className={cx("effort-pill", effort?.confirmed && "confirmed")} title={effort?.confirmed ? "Your estimate" : "Model estimate. You confirm the minutes in review"}>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.2 1.4" /></svg>
    {minutes}m{!effort?.confirmed && <small>est.</small>}
  </span>;
}

interface TriageCardProps {
  save: SaveListItem;
  goalName?: string;
  selected: boolean;
  onSelect: () => void;
}

export function TriageCard({ save, goalName, selected, onSelect }: TriageCardProps) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [cropped, setCropped] = useState(false);
  const title = save.action?.title ?? null;
  return (
    <article className={cx("tcard", selected && "selected")}>
      <button type="button" className="tcard-main" onClick={onSelect} aria-pressed={selected}>
        <span className={cx("tcard-media", cropped && "cropped", state === "loading" && "loading")}>
          {state === "failed" ? <span className="tcard-missing">Missing</span> : (
            <img
              src={save.screenshotUrl}
              alt={`Screenshot of ${title ?? "a saved post"}`}
              loading="lazy"
              onLoad={(event) => {
                const img = event.currentTarget;
                setCropped((img.naturalHeight / img.naturalWidth) * img.clientWidth > PREVIEW_MAX);
                setState("ready");
              }}
              onError={() => setState("failed")}
            />
          )}
        </span>
        <span className="tcard-body">
          <span className="tcard-title">{title ?? "Missing"}</span>
          <span className="tcard-meta"><DeadlineBadge save={save} /><EffortPill save={save} /></span>
          <span className="tcard-chips">
            <StatusChip status={saveStatus(save)} />
            {save.action?.goalId != null && goalName && <GoalChip goalId={save.action.goalId} name={goalName} />}
          </span>
        </span>
      </button>
      <div className="tcard-actions">
        <Link to={`/app/saves/${save.saveId}`} className="tcard-cta">{saveCtaLabel(save)} <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
