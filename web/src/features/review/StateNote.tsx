import { Link } from "react-router-dom";
import type { Action } from "../../api/types";
import { StatusChip } from "../../ui/StatusChip";
import type { Proposal, Stage } from "./model";
import "./review.css";

interface Props {
  stage: Stage;
  action: Action;
  proposal: Proposal | null;
  minutes: number | null;
}

// One short card per state, with a word and a shape. All times are the server's relative strings, shown as is.
export function StateNote({ stage, action, proposal, minutes }: Props) {
  const check = action.check;

  if (action.status === "done") {
    return <p role="status" className="font-semibold text-fits">Marked done · Self reported</p>;
  }

  if (stage === "proposed" && proposal) {
    return (
      <div className="rv-note is-proposed">
        <span className="rv-note-label"><i aria-hidden="true" />{proposal.mode === "move" ? "New time to approve" : "Proposed time"}</span>
        <p className="rv-time">{proposal.slot.rangeRelative}</p>
        {proposal.latest && (
          <p className="rv-hint">
            Latest feasible start, given your current availability and confirmed effort: {proposal.latest.startRelative}
          </p>
        )}
      </div>
    );
  }

  if (stage === "conflict" && check) {
    const first = check.conflicts[0];
    const event = first?.title ?? first?.summary ?? "An event";
    const current = action.block?.startRelative ?? "";
    const alt = check.alternative?.startRelative;
    return (
      <div className="rv-note is-conflict" role="status">
        <span className="rv-note-label"><i aria-hidden="true" />Conflict</span>
        <p>
          {event} now overlaps your {current} block.{alt ? ` Move to ${alt}?` : ""}
        </p>
      </div>
    );
  }

  if (stage === "nofit") {
    const length = minutes ?? action.effort.confirmedMin;
    const deadline = action.deadline?.relative ?? "your deadline";
    return (
      <div className="rv-note is-nofit" role="status">
        <span className="rv-note-label"><i aria-hidden="true" />Does not fit</span>
        <p>
          No free {length} min before {deadline} in your working hours. Try fewer minutes or wider hours
        </p>
        <Link to="/app/settings" className="text-small font-semibold underline underline-offset-4">
          Working hours
        </Link>
      </div>
    );
  }

  if (stage === "fits" && check) {
    return (
      <div className="flex items-center gap-2">
        <StatusChip status="fits" />
        <span className="text-small text-muted">Checked {check.checkedAtRelative}</span>
      </div>
    );
  }

  return null;
}
