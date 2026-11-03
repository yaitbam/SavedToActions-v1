import { get, put } from "./client";
import type { Action, Goal, Insights } from "./types";

export const getGoals = () => get<Goal[]>("/api/goals");
export const renameGoal = (id: number, name: string) =>
  put<{ id: number; name: string }>(`/api/goals/${id}`, { name });
export const getGoal = (id: number) =>
  get<{ goal: Goal; actions: Action[] } & Partial<Insights>>(`/api/goals/${id}`);
