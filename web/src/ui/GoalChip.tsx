import { goalSlot } from "../api/goalColors";
import { Chip } from "./Chip";
import { cx } from "./cx";

// Six color slots. The first three keep the look of the original preset goals.
export const GOAL_COLOR_CLASSES = ["bg-goal-earn", "bg-goal-learn", "bg-goal-deadlines", "bg-goal-c3", "bg-goal-c4", "bg-goal-c5"];

export function colorDotClass(slot: number): string {
  return GOAL_COLOR_CLASSES[((slot % GOAL_COLOR_CLASSES.length) + GOAL_COLOR_CLASSES.length) % GOAL_COLOR_CLASSES.length];
}

export function goalDotClass(goalId: number): string {
  return colorDotClass(goalSlot(goalId));
}

interface GoalChipProps {
  goalId: number | null;
  name: string | null | undefined;
}

export function GoalChip({ goalId, name }: GoalChipProps) {
  if (goalId === null || !name) return <Chip tone="missing">Missing</Chip>;
  return (
    <Chip>
      <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", goalDotClass(goalId))} />
      <span className="truncate">{name}</span>
    </Chip>
  );
}
