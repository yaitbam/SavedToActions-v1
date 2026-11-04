import { get, post, put } from "./client";
import type { Settings } from "./types";

export const getSettings = () => get<Settings>("/api/settings");
export const saveSettings = (changes: Partial<Settings>) => put<Settings>("/api/settings", changes);

// Offset is a display string such as "+00:00", worked out on the server.
export interface TimezoneOption { id: string; offset: string }
export const getTimezones = () => get<{ zones: TimezoneOption[] }>("/api/timezones");

// First login: the default timezone is asked about once. done turns true when the user confirms or picks their own.
export const getTimezoneSetup = () => get<{ done: boolean; tz: string | null }>("/api/timezone/setup");
export const confirmTimezone = (tz: string) => post<{ done: true; tz: string }>("/api/timezone/setup", { tz });
