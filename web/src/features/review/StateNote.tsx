import { Link } from "react-router-dom";
import type { Action } from "../../api/types";
import type { Proposal, Stage } from "./useReview";

interface Props {
  stage: Stage;
  action: Action;
  proposal: Proposal | null;
  minutes: number | null;
}

// One short card per state. All times are the server's relative strings, shown as is.
export function StateNote({ stage, action, proposal, minutes }: Props) {
  const check = action.check;

  if (stage === "proposed" && proposal) {
    return (
      <div className="space-y-1 rounded-card bg-bg p-4">
        <p className="font-semibold">{proposal.slot.rangeRelative}</p>
        {proposal.latest && (
          <p className="text-small text-muted">
            Latest feasible start, given your current availability and confirmed effort: {proposal.latest.startRelative}
          </p>
        )}
      </div>
    );
  }

  if (stage === "conflict" && check) {
    const event = check.conflicts[0]?.title ?? "An event";
    const current = action.block?.startRelative ?? "";
    const alt = check.alternative?.startRelative;
    return (
      <p className="rounded-card bg-conflict-bg p-4 text-conflict">
        {event} now overlaps your {current} block.{alt ? ` Move to ${alt}?` : ""}
      </p>
    );
  }

  if (stage === "nofit") {
    const length = minutes ?? action.effort.confirmedMin;
    const deadline = action.deadline?.relative ?? "your deadline";
    return (
      <div className="space-y-2 rounded-card bg-nofit-bg p-4 text-nofit">
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
    return <p className="text-small text-muted">Checked {check.checkedAtRelative}</p>;
  }

  return null;
}
