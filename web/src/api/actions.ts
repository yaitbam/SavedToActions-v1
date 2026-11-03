import { get, patch, post } from "./client";
import type {
  Action,
  ActionList,
  ActionPatch,
  AgentPlan,
  ApproveResult,
  Check,
  MoveResult,
  ProposeResult,
  RecheckAllResult,
  RecheckResult,
  SkipResult,
} from "./types";

export const listActions = (query?: Record<string, string | number | boolean | undefined>) =>
  get<ActionList>("/api/actions", query);
export const getAction = (id: number) => get<Action>(`/api/actions/${id}`);
export const updateAction = (id: number, changes: ActionPatch) =>
  patch<Action>(`/api/actions/${id}`, changes);

export const proposeSlot = (id: number) => post<ProposeResult>(`/api/actions/${id}/propose`, {});
export const agentPlan = (id: number, instruction: string) =>
  post<AgentPlan>(`/api/actions/${id}/agent-plan`, { instruction });

export const approveSlot = (id: number, startUtc: string, endUtc: string) =>
  post<ApproveResult>(`/api/actions/${id}/approve`, { approved: true, startUtc, endUtc });
export const moveBlock = (id: number, startUtc: string, endUtc: string) =>
  post<MoveResult>(`/api/actions/${id}/move`, { approved: true, startUtc, endUtc });

export const recheckOne = (id: number) => post<RecheckResult>(`/api/actions/${id}/recheck`, {});
export const recheckAll = (ids: number[]) => post<RecheckAllResult>("/api/actions/recheck", { ids });
export const listChecks = (id: number, limit?: number) =>
  get<{ checks: Check[] }>(`/api/actions/${id}/checks`, { limit });

export const markDone = (id: number) => post<{ action: Action }>(`/api/actions/${id}/done`, {});
export const skipAction = (id: number, removeFromCalendar = false) =>
  post<SkipResult>(
    `/api/actions/${id}/skip`,
    removeFromCalendar ? { removeFromCalendar: true, approved: true } : {},
  );
