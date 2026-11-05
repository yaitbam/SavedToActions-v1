import { describe, expect, it } from "vitest";
import type { Action } from "../../api/types";
import { stageOf, type Proposal } from "./model";

const action = (status: string, state?: "green" | "amber" | "red") =>
  ({ id: 1, status, check: state ? { state } : null }) as unknown as Action;
const flags = { noSlot: false, unlocked: false, kept: false };
const proposal = { mode: "new", slot: {}, latest: null } as unknown as Proposal;

describe("stageOf", () => {
  it("starts at effort, then moves to proposed once a time is on screen", () => {
    expect(stageOf(null, null, flags)).toBe("effort");
    expect(stageOf(action("open"), null, flags)).toBe("effort");
    expect(stageOf(action("open"), proposal, flags)).toBe("proposed");
  });

  it("says no time fits when the search found nothing", () => {
    expect(stageOf(action("open"), null, { ...flags, noSlot: true })).toBe("nofit");
  });

  it("follows the recheck result for a booked save", () => {
    expect(stageOf(action("planned", "green"), null, flags)).toBe("fits");
    expect(stageOf(action("planned", "amber"), null, flags)).toBe("conflict");
    expect(stageOf(action("planned", "amber"), null, { ...flags, kept: true })).toBe("fits");
    expect(stageOf(action("planned", "red"), null, flags)).toBe("nofit");
  });

  it("lets the user plan a booked save again once it is unlocked", () => {
    expect(stageOf(action("planned", "green"), proposal, { ...flags, unlocked: true })).toBe("proposed");
  });

  it("treats done and skipped saves as finished", () => {
    expect(stageOf(action("done"), proposal, flags)).toBe("done");
    expect(stageOf(action("skipped"), null, flags)).toBe("done");
  });
});
