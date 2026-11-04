import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { SaveListItem } from "../../api/types";
import { Chip } from "../../ui/Chip";
import { GoalChip } from "../../ui/GoalChip";
import { StatusChip } from "../../ui/StatusChip";
import { saveStatus } from "./model";
import { DeadlineBadge, EffortPill } from "./TriageCard";

interface InspectorProps {
  save: SaveListItem;
  goalName?: string;
  onClose: () => void;
}

// Split screen preview. Minutes are confirmed and slots approved in Review, so this only links there.
export function Inspector({ save, goalName, onClose }: InspectorProps) {
  const action = save.action;
  const root = useRef<HTMLElement>(null);
  const quote = action?.deadline?.quote ?? action?.evidence.quote ?? null;
  const badge = action?.evidence.badgeLabel ?? null;
  const suggested = action?.effort.suggestedMin ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    root.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, save.saveId]);

  return (
    <aside ref={root} tabIndex={-1} className="inspector-drawer animate-enter" aria-label="Save inspector">
      <header>
        <div>
          <p className="drawer-kicker">Selected save</p>
          <h2>{action?.title ?? "Missing"}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close inspector" className="drawer-close">Esc</button>
      </header>
      <div className="drawer-preview"><img src={save.screenshotUrl} alt={`Screenshot of ${action?.title ?? "a saved post"}`} /></div>
      <div className="drawer-chips">
        <StatusChip status={saveStatus(save)} />
        {action?.goalId != null && goalName ? <GoalChip goalId={action.goalId} name={goalName} /> : <Chip tone="missing">Goal: Missing</Chip>}
      </div>
      <section>
        <h3>Deadline and evidence</h3>
        <div className="drawer-row"><DeadlineBadge save={save} />{action?.deadline && <span className="drawer-rel">{action.deadline.relative}</span>}</div>
        {quote ? (
          <blockquote>
            “{quote}”
            {badge && <footer>{badge}</footer>}
          </blockquote>
        ) : <p className="drawer-muted">No supporting quote. A deadline only exists when its quote is found in your note or the transcription.</p>}
      </section>
      <section>
        <h3>Effort</h3>
        <div className="drawer-row"><EffortPill save={save} /></div>
        <p className="drawer-muted">
          {action?.effort.confirmed ? "Confirmed by you. Only confirmed minutes are scheduled." : suggested !== null ? "This is a model estimate. Only the minutes you confirm in review are scheduled." : "No estimate. You choose the minutes in review."}
        </p>
      </section>
      <footer className="drawer-foot">
        <Link to={`/app/saves/${save.saveId}`} className="drawer-cta">Review &amp; schedule <span aria-hidden="true">→</span></Link>
        <p>You confirm minutes and approve the slot on the next screen.</p>
      </footer>
    </aside>
  );
}
