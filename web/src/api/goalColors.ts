// Goal colors come from the server as a slot per goal. Chips only know a goal id, so the
// slots are remembered here as goals load, with the old id based color as the fallback.
const slots = new Map<number, number>();

export function registerGoals(goals: Array<{ id: number; color: number }>) {
  for (const goal of goals) slots.set(goal.id, goal.color);
}

export function goalSlot(goalId: number): number {
  return slots.get(goalId) ?? goalId - 1;
}
