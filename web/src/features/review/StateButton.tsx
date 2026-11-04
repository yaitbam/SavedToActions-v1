import { Link } from "react-router-dom";
import type { Action } from "../../api/types";
import { Button, buttonClass } from "../../ui/Button";
import type { Proposal, Stage } from "./model";

export interface StateHandlers {
  plan: () => void;
  book: () => void;
  done: () => void;
  recheck: () => void;
  moveToAlternative: () => void;
  keep: () => void;
  unlock: () => void;
  skip: () => void;
  otherTime: () => void;
  editDetails: () => void;
}

interface Props {
  stage: Stage;
  action: Action;
  proposal: Proposal | null;
  minutes: number | null;
  busy: string | null;
  on: StateHandlers;
}

// One primary button per state, as in the plan table. Never more than one primary.
export function StateButton({ stage, action, proposal, minutes, busy, on }: Props) {
  const working = busy !== null;

  if (stage === "done") {
    return (
      <Link to="/app" className={buttonClass("primary")}>
        Back to Home
      </Link>
    );
  }

  let primary: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean };
  let secondary: { label: string; onClick: () => void; loading?: boolean } | null;

  switch (stage) {
    case "effort":
      primary = {
        label: minutes ? `Confirm ${minutes} min and find a time` : "Confirm minutes and find a time",
        onClick: on.plan,
        loading: busy === "plan",
        disabled: !minutes,
      };
      secondary = { label: "Edit details", onClick: on.editDetails };
      break;
    case "proposed":
      primary = {
        label: proposal?.mode === "move" ? `Move to ${proposal.slot.startRelative}` : "Add to calendar",
        onClick: on.book,
        loading: busy === "book",
      };
      secondary = { label: "Other time", onClick: on.otherTime, loading: busy === "plan" };
      break;
    case "conflict": {
      const alt = action.check?.alternative;
      primary = alt
        ? { label: `Move to ${alt.startRelative}`, onClick: on.moveToAlternative, loading: busy === "book" }
        : { label: "Change minutes or hours", onClick: on.unlock };
      secondary = { label: `Keep ${action.block?.startRelative ?? "current time"}`, onClick: on.keep };
      break;
    }
    case "nofit":
      primary = { label: "Change minutes or hours", onClick: on.unlock };
      secondary = { label: "Skip", onClick: on.skip, loading: busy === "skip" };
      break;
    default:
      primary = { label: "Mark done", onClick: on.done, loading: busy === "done" };
      secondary = { label: "Recheck now", onClick: on.recheck, loading: busy === "recheck" };
  }

  return (
    <div className="space-y-2">
      {primary.onClick === on.done && action.block && <p className="text-small text-muted">Also marks the calendar event title Done</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={primary.onClick} loading={primary.loading} disabled={primary.disabled || (working && !primary.loading)}>
          {primary.label}
        </Button>
        {secondary && (
          <Button variant="secondary" onClick={secondary.onClick} loading={secondary.loading} disabled={working && !secondary.loading}>
            {secondary.label}
          </Button>
        )}
      </div>
    </div>
  );
}
