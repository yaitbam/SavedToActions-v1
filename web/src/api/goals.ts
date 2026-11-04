import { get, post, put } from "./client";
import { registerGoals } from "./goalColors";
import type { Action, Goal, GoalBase, Insights, StarterGoal } from "./types";

export const getGoals = async () => {
  const goals = await get<Goal[]>("/api/goals");
  registerGoals(goals);
  return goals;
};
export const getStarterGoals = () => get<StarterGoal[]>("/api/goals/starters");
export const getGoal = async (id: number) => {
  const result = await get<{ goal: Goal; actions: Action[] } & Partial<Insights>>(`/api/goals/${id}`);
  registerGoals([result.goal]);
  return result;
};

export interface GoalInput {
  name: string;
  description?: string | null;
  color?: number;
}

export const createGoal = (input: Pick<GoalInput, "name" | "description">) => post<GoalBase>("/api/goals", input);
export const updateGoal = (id: number, input: Partial<GoalInput>) => put<GoalBase>(`/api/goals/${id}`, input);
export const archiveGoal = (id: number) => post<GoalBase>(`/api/goals/${id}/archive`);
export const restoreGoal = (id: number) => post<GoalBase>(`/api/goals/${id}/restore`);
export const reorderGoals = (ids: number[]) => put<GoalBase[]>("/api/goals/order", { ids });

export const getGoalsSetup = () => get<{ done: boolean }>("/api/goals/setup");
// Either the goals the user chose, in order, or { skip: true } to keep the starting goals.
export const setupGoals = (input: { skip: true } | { goals: StarterGoal[] }) => post<GoalBase[]>("/api/goals/setup", input);
