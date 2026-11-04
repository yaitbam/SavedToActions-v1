import type { CheckState } from "../api/types";
import { Chip, type Tone } from "./Chip";

export type StatusKey =
  | "fits"
  | "conflict"
  | "nofit"
  | "done"
  | "planned"
  | "review"
  | "skipped"
  | "needs_input"
  | "error"
  | "drift"
  | "passed"
  | "missing";

const statuses: Record<StatusKey, { label: string; tone: Tone }> = {
  fits: { label: "Planned", tone: "fits" },
  conflict: { label: "Conflict", tone: "conflict" },
  nofit: { label: "Doesn't fit", tone: "nofit" },
  done: { label: "Done", tone: "fits" },
  planned: { label: "Planned", tone: "fits" },
  review: { label: "Needs review", tone: "missing" },
  skipped: { label: "Skipped", tone: "missing" },
  needs_input: { label: "Needs input", tone: "missing" },
  error: { label: "Error", tone: "nofit" },
  drift: { label: "Calendar changed", tone: "conflict" },
  passed: { label: "Deadline passed", tone: "nofit" },
  missing: { label: "Missing", tone: "missing" },
};

const fromCheck: Record<CheckState, StatusKey> = {
  green: "fits",
  amber: "conflict",
  red: "nofit",
  needs_input: "needs_input",
  error: "error",
};

export function statusFromCheck(state: CheckState): StatusKey {
  return fromCheck[state];
}

// A planned save: the latest check decides the word. A passing check reads "Planned", the same as no check yet.
export function plannedStatus(check: { state: CheckState } | null | undefined): StatusKey {
  return check ? statusFromCheck(check.state) : "planned";
}

export function StatusChip({ status }: { status: StatusKey }) {
  const { label, tone } = statuses[status];
  return <Chip tone={tone}>{label}</Chip>;
}
