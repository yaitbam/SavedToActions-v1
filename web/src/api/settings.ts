import { get, put } from "./client";
import type { Settings } from "./types";

export const getSettings = () => get<Settings>("/api/settings");
export const saveSettings = (changes: Partial<Settings>) => put<Settings>("/api/settings", changes);

// Offset is a display string such as "+00:00", worked out on the server.
export interface TimezoneOption { id: string; offset: string }
export const getTimezones = () => get<{ zones: TimezoneOption[] }>("/api/timezones");
