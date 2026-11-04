import { del, get, patch, post, postForm } from "./client";
import type {
  Action,
  DeleteSaveResult,
  ExtractionJob,
  Page,
  PostLink,
  SaveCreated,
  SaveCreatedAsync,
  SaveDetail,
  SaveListItem,
} from "./types";

function saveForm(image: File, note?: string, link?: string) {
  const form = new FormData();
  form.append("image", image);
  if (note) form.append("note", note);
  if (link) form.append("link", link);
  return form;
}

export const createSave = (image: File, note?: string, idempotencyKey?: string, link?: string) =>
  postForm<SaveCreated>("/api/saves", saveForm(image, note, link), idempotencyKey);
export const createSaveAsync = (image: File, note?: string, idempotencyKey?: string, link?: string) =>
  postForm<SaveCreatedAsync>("/api/saves?async=true", saveForm(image, note, link), idempotencyKey);

export const retryExtraction = (saveId: number) =>
  post<SaveCreated>(`/api/saves/${saveId}/extract`, {});
export const getExtraction = (jobId: number) => get<ExtractionJob>(`/api/extractions/${jobId}`);

export const listSaves = (query?: { status?: string; limit?: number; offset?: number }) =>
  get<Page<SaveListItem>>("/api/saves", query);
export const getSave = (saveId: number) => get<SaveDetail>(`/api/saves/${saveId}`);
export const saveNote = (saveId: number, note: string) =>
  patch<{ saveId: number; note: string; link: PostLink | null; action: Action | null }>(`/api/saves/${saveId}`, { note });
// An empty string or null removes the link. The server tidies it and answers with the cleaned version.
export const saveLink = (saveId: number, link: string | null) =>
  patch<{ saveId: number; note: string; link: PostLink | null; action: Action | null }>(`/api/saves/${saveId}`, { link });
export const confirmEffort = (saveId: number, confirmedEffortMin: number) =>
  post<Action>(`/api/saves/${saveId}/confirm`, { confirmedEffortMin });

// Permanent. removeFromCalendar also deletes the booked calendar block. The server checks that it is gone first.
export const deleteSave = (saveId: number, removeFromCalendar: boolean) =>
  del<DeleteSaveResult>(`/api/saves/${saveId}`, { approved: true, removeFromCalendar });
