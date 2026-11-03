import { get, patch, post, postForm } from "./client";
import type {
  Action,
  ExtractionJob,
  Page,
  SaveCreated,
  SaveCreatedAsync,
  SaveDetail,
  SaveListItem,
} from "./types";

function saveForm(image: File, note?: string) {
  const form = new FormData();
  form.append("image", image);
  if (note) form.append("note", note);
  return form;
}

export const createSave = (image: File, note?: string, idempotencyKey?: string) =>
  postForm<SaveCreated>("/api/saves", saveForm(image, note), idempotencyKey);
export const createSaveAsync = (image: File, note?: string, idempotencyKey?: string) =>
  postForm<SaveCreatedAsync>("/api/saves?async=true", saveForm(image, note), idempotencyKey);

export const retryExtraction = (saveId: number) =>
  post<SaveCreated>(`/api/saves/${saveId}/extract`, {});
export const getExtraction = (jobId: number) => get<ExtractionJob>(`/api/extractions/${jobId}`);

export const listSaves = (query?: { status?: string; limit?: number; offset?: number }) =>
  get<Page<SaveListItem>>("/api/saves", query);
export const getSave = (saveId: number) => get<SaveDetail>(`/api/saves/${saveId}`);
export const saveNote = (saveId: number, note: string) =>
  patch<{ saveId: number; note: string; action: Action | null }>(`/api/saves/${saveId}`, { note });
export const confirmEffort = (saveId: number, confirmedEffortMin: number) =>
  post<Action>(`/api/saves/${saveId}/confirm`, { confirmedEffortMin });
