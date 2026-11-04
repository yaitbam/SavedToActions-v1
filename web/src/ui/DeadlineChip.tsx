import type { Deadline } from "../api/types";
import { Chip } from "./Chip";

// Deadlines read the same everywhere: red, with the short date. The time is in the tooltip and in Details.
export function DeadlineChip({ deadline }: { deadline: Pick<Deadline, "short" | "display" | "relative"> }) {
  const text = deadline.short ?? deadline.display ?? deadline.relative;
  return <Chip tone="nofit" title={deadline.display ?? undefined}>Due {text}</Chip>;
}
