import { del, get, patch, post } from "./client";

export interface Session {
  authenticated: boolean;
  demo_available?: boolean;
  kind: "owner" | "user" | "demo" | null;
  credits?: { remaining: number; max: number; display: string } | null;
  calendar_email?: string | null;
  profile_complete: boolean;
  name: string | null;
  email: string | null;
  csrf_token: string | null;
}

export const getSession = () => get<Session>("/auth/session");
export const saveProfile = (name: string) => patch<unknown>("/api/me", { name });
export const enterDemo = () => post<unknown>("/auth/demo");
export const logout = () => post<unknown>("/auth/logout");
// Removes the account, its saves, screenshots and settings. Events already on Google Calendar are kept.
export const CONFIRM_DELETE_ACCOUNT = "DELETE MY ACCOUNT";
export const deleteAccount = () => del<{ deleted: boolean; google_revoked: boolean | null }>("/api/me", { approved: true, confirmation: CONFIRM_DELETE_ACCOUNT });
