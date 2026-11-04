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

// effortMin: the minutes on screen. They are used for this search only, nothing is saved.
// notBeforeUtc: "another time", start no earlier than this instant.
export const proposeSlot = (id: number, options: { effortMin?: number; notBeforeUtc?: string } = {}) =>
  post<ProposeResult>(`/api/actions/${id}/propose`, options);
export const agentPlan = (id: number, instruction: string) =>
  post<AgentPlan>(`/api/actions/${id}/agent-plan`, { instruction });

// effortMin: the minutes shown with the time. Approving confirms them.
export const approveSlot = (id: number, startUtc: string, endUtc: string, effortMin?: number) =>
  post<ApproveResult>(`/api/actions/${id}/approve`, { approved: true, startUtc, endUtc, ...(effortMin ? { effortMin } : {}) });
export const moveBlock = (id: number, startUtc: string, endUtc: string) =>
  post<MoveResult>(`/api/actions/${id}/move`, { approved: true, startUtc, endUtc });

export const recheckOne = (id: number) => post<RecheckResult>(`/api/actions/${id}/recheck`, {});
export const recheckAll = (ids: number[]) => post<RecheckAllResult>("/api/actions/recheck", { ids });
export const listChecks = (id: number, limit?: number) =>
  get<{ checks: Check[] }>(`/api/actions/${id}/checks`, { limit });

export const markDone = (id: number) => post<{ action: Action }>(`/api/actions/${id}/done`, { approved: true });
// Takes a booked block off the calendar and keeps the save open. The server checks the event is gone first.
export const unplanAction = (id: number) =>
  post<{ action: Action; calendar: { hadBlock: boolean; removed: boolean } }>(`/api/actions/${id}/unplan`, { approved: true });
export const skipAction = (id: number, removeFromCalendar = false) =>
  post<SkipResult>(
    `/api/actions/${id}/skip`,
    removeFromCalendar ? { removeFromCalendar: true, approved: true } : {},
  );
