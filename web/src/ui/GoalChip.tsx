import { Chip } from "./Chip";
import { cx } from "./cx";

// Goal ids are 1, 2, 3 in preset order: Earn more, Learn a skill, Don't miss deadlines.
const dots = ["bg-goal-earn", "bg-goal-learn", "bg-goal-deadlines"];

export function goalDotClass(goalId: number): string {
  return dots[(((goalId - 1) % dots.length) + dots.length) % dots.length];
}

interface GoalChipProps {
  goalId: number | null;
  name: string | null | undefined;
}

export function GoalChip({ goalId, name }: GoalChipProps) {
  if (goalId === null || !name) return <Chip tone="missing">Missing</Chip>;
  return (
    <Chip>
      <span aria-hidden="true" className={cx("size-2 rounded-full", goalDotClass(goalId))} />
      {name}
    </Chip>
  );
}
