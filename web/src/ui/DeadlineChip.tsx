import type { Deadline } from "../api/types";
import { Chip } from "./Chip";

type DeadlineText = Partial<Pick<Deadline, "short" | "display" | "relative">>;

const DATE_IN_TEXT = /\b(\d{1,2} [A-Z][a-z]{2})(?: (\d{4}))?\b/;

// The date alone, such as "22 Nov". The server sends it as `short`. If an older server does not, the date is
// cut out of the text it did send. Nothing is converted here, only shortened.
export function shortDeadline(deadline: DeadlineText): string {
  if (deadline.short) return deadline.short;
  const found = deadline.display?.match(DATE_IN_TEXT) ?? deadline.relative?.match(DATE_IN_TEXT);
  if (found) return found[2] && Number(found[2]) !== new Date().getFullYear() ? `${found[1]} ${found[2]}` : found[1];
  return deadline.display ?? deadline.relative ?? "";
}

// Deadlines read the same everywhere: red, with the short date. The time is in the tooltip and in Details.
export function DeadlineChip({ deadline }: { deadline: DeadlineText }) {
  return <Chip tone="nofit" title={deadline.display ?? undefined}>Due {shortDeadline(deadline)}</Chip>;
}
