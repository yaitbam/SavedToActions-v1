import type { Action, Slot, SlotLabel } from "../../api/types";

export interface Proposal {
  mode: "new" | "move";
  slot: Slot;
  latest: SlotLabel | null;
}

export type Stage = "effort" | "proposed" | "fits" | "conflict" | "nofit" | "done";

export function stageOf(
  action: Action | null,
  proposal: Proposal | null,
  flags: { noSlot: boolean; unlocked: boolean; kept: boolean },
): Stage {
  if (!action) return "effort";
  if (action.status === "done" || action.status === "skipped") return "done";
  if (action.status === "planned" && !flags.unlocked) {
    const state = action.check?.state;
    if (state === "amber") return flags.kept ? "fits" : "conflict";
    return state === "red" ? "nofit" : "fits";
  }
  if (proposal) return "proposed";
  return flags.noSlot ? "nofit" : "effort";
}
