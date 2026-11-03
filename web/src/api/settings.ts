import { get, put } from "./client";
import type { Settings } from "./types";

export const getSettings = () => get<Settings>("/api/settings");
export const saveSettings = (changes: Partial<Settings>) => put<Settings>("/api/settings", changes);
