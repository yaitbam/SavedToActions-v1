import type { CheckState } from "../api/types";
import { Chip, type Tone } from "./Chip";

export type StatusKey =
  | "fits"
  | "conflict"
  | "nofit"
  | "done"
  | "planned"
  | "needs_input"
  | "error"
  | "drift"
  | "missing";

const statuses: Record<StatusKey, { label: string; tone: Tone }> = {
  fits: { label: "Fits", tone: "fits" },
  conflict: { label: "Conflict", tone: "conflict" },
  nofit: { label: "Doesn't fit", tone: "nofit" },
  done: { label: "Done", tone: "fits" },
  planned: { label: "Planned", tone: "brand" },
  needs_input: { label: "Needs input", tone: "missing" },
  error: { label: "Error", tone: "nofit" },
  drift: { label: "Calendar changed", tone: "conflict" },
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

export function StatusChip({ status }: { status: StatusKey }) {
  const { label, tone } = statuses[status];
  return <Chip tone={tone}>{label}</Chip>;
}
