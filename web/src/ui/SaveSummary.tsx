import { Chip } from "./Chip";
import { cx } from "./cx";
import { GoalChip } from "./GoalChip";
import { StatusChip, type StatusKey } from "./StatusChip";

interface SaveSummaryProps {
  title: string | null;
  goalId: number | null;
  goalName?: string | null;
  status: StatusKey | null;
  lines?: 1 | 2;
}

const MAX_CHIPS = 2;

// Title and chips of a saved post. At most 2 chips, and the word Missing appears once.
export function SaveSummary({ title, goalId, goalName, status, lines = 2 }: SaveSummaryProps) {
  const titleMissing = !title;
  const goalSet = goalId !== null && !!goalName;
  const chips = [
    titleMissing && (
      <Chip key="title" tone="missing">
        Missing
      </Chip>
    ),
    status && <StatusChip key="status" status={status} />,
    goalSet && <GoalChip key="goal" goalId={goalId} name={goalName} />,
    // A missing goal only gets its chip when no other field already said Missing.
    !goalSet && !titleMissing && <GoalChip key="goal" goalId={null} name={null} />,
  ]
    .filter(Boolean)
    .slice(0, MAX_CHIPS);

  return (
    <div className="space-y-2">
      {title && <p className={cx("font-semibold", lines === 1 ? "line-clamp-1" : "line-clamp-2")}>{title}</p>}
      {chips.length > 0 && <div className="flex flex-wrap gap-2">{chips}</div>}
    </div>
  );
}
