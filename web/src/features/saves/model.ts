import { listSaves } from "../../api/saves";
import type { SaveListItem } from "../../api/types";
import { plannedStatus, type StatusKey } from "../../ui/StatusChip";

export const filters = ["All", "Needs review", "Planned", "Done"] as const;
export type SaveFilter = (typeof filters)[number];

// Walk every page so search also finds older saves and failed extractions.
export async function loadSaves() {
  const items: SaveListItem[] = [];
  let total = 0;
  do {
    const page = await listSaves({ limit: 100, offset: items.length });
    items.push(...page.items);
    total = page.total;
    if (!page.items.length) break;
  } while (items.length < total);
  return items;
}

export function matchesSave(save: SaveListItem, filter: SaveFilter, query: string) {
  const status = save.action?.status;
  if (filter === "Needs review" && status && status !== "open") return false;
  if (filter === "Planned" && status !== "planned") return false;
  if (filter === "Done" && status !== "done") return false;
  const text = [save.action?.title, save.note, save.action?.transcription].filter(Boolean).join(" ");
  return text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function saveStatus(save: SaveListItem): StatusKey {
  const action = save.action;
  if (!action) return save.extraction === "failed" ? "error" : "review";
  if (action.status === "planned") return plannedStatus(action.check);
  if (action.status === "open") return "review";
  return action.status;
}
