import type { Action, Home, HomeAttention, HomeRecentSave, HomeSummary, Week, WeekChip, WeekDay } from "../../api/types";
import { plannedStatus, type StatusKey } from "../../ui/StatusChip";

// Status word for a save card. Open saves with confirmed minutes show nothing.
export function summaryStatus(action: HomeSummary): StatusKey | null {
  if (action.status === "done") return "done";
  if (action.status === "skipped") return null;
  if (action.status === "planned") return plannedStatus(action.check);
  return action.effort.confirmed ? null : "needs_input";
}

export function attentionStatus(item: HomeAttention, hasConflict: boolean): StatusKey {
  switch (item.state) {
    case "red":
      return item.reason === "deadline_passed" ? "passed" : "nofit";
    case "amber":
      return hasConflict ? "conflict" : "drift";
    case "needs_input":
      return "needs_input";
    case "readback_drift":
      return "drift";
    default:
      return "error";
  }
}

const attentionIds = (home: Home) => new Set(home.needs_attention.map((item) => item.action.id));

// Open saves that still miss a goal or confirmed minutes. Saves already in needs_attention are left out.
export function inboxSaves(home: Home): HomeRecentSave[] {
  const shown = attentionIds(home);
  return home.recent_saves.filter(
    (save) =>
      save.action?.status === "open" &&
      !shown.has(save.action.id) &&
      (save.action.goalId === null || !save.action.effort.confirmed),
  );
}

// The planned block that starts first and has not ended, skipping saves already shown as attention cards.
export function pickNextUp(home: Home): HomeSummary | null {
  const shown = attentionIds(home);
  const pool = [home.next_up, ...home.upcoming].filter(
    (item): item is HomeSummary =>
      !!item && item.status === "planned" && !!item.block && item.block.endUtc > home.now.utc && !shown.has(item.id),
  );
  pool.sort((a, b) => (a.block?.startUtc ?? "").localeCompare(b.block?.startUtc ?? ""));
  return pool[0] ?? null;
}

export interface WeekBlock {
  chip: WeekChip;
  goalId: number | null;
  title: string;
}

export interface WeekRow {
  day: WeekDay;
  today: boolean;
  blocks: WeekBlock[];
}

// Our blocks only (kind "prep"). The server sends no goal on a chip, so it is matched to the
// planned action whose block starts at the same display string.
export function weekRows(week: Week, planned: Action[]): WeekRow[] {
  const byStart = new Map<string, Action>();
  for (const action of planned) if (action.block) byStart.set(action.block.startDisplay, action);
  return week.days.map((day) => ({
    day,
    today: day.date === week.todayDate,
    blocks: day.chips
      .filter((chip) => chip.kind === "prep")
      .map((chip) => {
        const match = byStart.get(chip.startDisplay);
        return { chip, goalId: match?.goalId ?? null, title: match?.title ?? chip.title };
      }),
  }));
}
