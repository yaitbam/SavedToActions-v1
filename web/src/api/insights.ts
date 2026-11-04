import { get } from "./client";
import { registerGoals } from "./goalColors";
import type { Insights } from "./types";

export const getInsights = async () => {
  const insights = await get<Insights>("/api/insights");
  registerGoals(insights.goals);
  return insights;
};
export const getAbout = () => get<{ name: string; model: string; provider: string }>("/api/about");
