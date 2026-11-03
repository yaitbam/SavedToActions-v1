import { get } from "./client";
import type { Trace, TraceSummary } from "./types";

export const listTraces = (actionId: number) =>
  get<{ traces: TraceSummary[] }>(`/api/actions/${actionId}/traces`);
export const getTrace = (traceId: number) => get<{ trace: Trace }>(`/api/traces/${traceId}`);
