import { get } from "./client";
import type { Home, Week } from "./types";

export const getHome = () => get<Home>("/api/home");
export const getWeek = (date?: string) => get<Week>("/api/week", { date });
