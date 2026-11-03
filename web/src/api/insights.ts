import { get } from "./client";
import type { Insights } from "./types";

export const getInsights = () => get<Insights>("/api/insights");
export const getAbout = () => get<{ name: string; model: string; provider: string }>("/api/about");
