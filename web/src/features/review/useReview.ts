import { useEffect, useState } from "react";
import {
  agentPlan,
  approveSlot,
  markDone,
  moveBlock,
  proposeSlot,
  recheckOne,
  skipAction,
  updateAction,
} from "../../api/actions";
import { errorText } from "../../api/errors";
import { getGoals } from "../../api/goals";
import { confirmEffort, getSave, retryExtraction } from "../../api/saves";
import type { Action, ActionPatch, AgentPlan, ProposeResult, Slot, SlotLabel } from "../../api/types";
import { useAsync } from "../../api/useAsync";

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

export function useReview(saveId: number) {
  const save = useAsync(() => getSave(saveId), [saveId]);
  const goals = useAsync(getGoals, []);
  const [action, setAction] = useState<Action | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [noSlot, setNoSlot] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [kept, setKept] = useState(false);
  const [preference, setPreference] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loaded = save.data?.action ?? null;
  useEffect(() => {
    setAction(loaded);
    setMinutes(loaded ? (loaded.effort.confirmedMin ?? loaded.effort.suggestedMin) : null);
  }, [save.data]);

  useEffect(() => {
    setProposal(null);
    setNoSlot(false);
    setUnlocked(false);
    setKept(false);
    setError(null);
  }, [saveId]);

  const extracting = !!save.data && !save.data.action && ["queued", "running"].includes(save.data.extractionStatus);
  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => void save.reload(), 2000);
    return () => clearInterval(timer);
  }, [extracting, save.reload]);

  async function run(label: string, job: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const applyPropose = (result: ProposeResult) => {
    if (result.found) setProposal({ mode: result.mode, slot: result.slot, latest: result.latestFeasibleStart });
    else setNoSlot(true);
  };

  const applyAgent = (result: AgentPlan) => {
    const slot = result.proposal ?? result.fallback;
    if (slot) setProposal({ mode: result.mode, slot, latest: null });
    else setNoSlot(true);
  };

  const settle = (next: Action) => {
    setAction(next);
    setProposal(null);
    setNoSlot(false);
    setUnlocked(false);
    setKept(false);
  };

  const plan = () =>
    run("plan", async () => {
      if (!minutes) return;
      const confirmed = await confirmEffort(saveId, minutes);
      setAction(confirmed);
      setNoSlot(false);
      setProposal(null);
      setKept(false);
      const text = preference.trim();
      if (text) applyAgent(await agentPlan(confirmed.id, text));
      else applyPropose(await proposeSlot(confirmed.id));
    });

  // Calendar writes. Each one needs a click from the user in the UI.
  const book = () =>
    run("book", async () => {
      if (!action || !proposal) return;
      const { slot, mode } = proposal;
      const result =
        mode === "move"
          ? await moveBlock(action.id, slot.startUtc, slot.endUtc)
          : await approveSlot(action.id, slot.startUtc, slot.endUtc);
      settle(result.action);
    });

  const moveToAlternative = () =>
    run("book", async () => {
      const alt = action?.check?.alternative;
      if (!action || !alt) return;
      settle((await moveBlock(action.id, alt.startUtc, alt.endUtc)).action);
    });

  const recheck = () =>
    run("recheck", async () => {
      if (!action) return;
      settle((await recheckOne(action.id)).action);
    });

  const done = () =>
    run("done", async () => {
      if (action) settle((await markDone(action.id)).action);
    });

  const skip = () =>
    run("skip", async () => {
      if (action) settle((await skipAction(action.id)).action);
    });

  const patch = (changes: ActionPatch) =>
    run("patch", async () => {
      if (action) setAction(await updateAction(action.id, changes));
    });

  const retryExtract = () =>
    run("retry", async () => {
      await retryExtraction(saveId);
      await save.reload();
    });

  const changeMinutes = (next: number | null) => {
    setMinutes(next);
    setProposal(null);
    setNoSlot(false);
  };

  const unlock = () => {
    setUnlocked(true);
    setNoSlot(false);
    setProposal(null);
  };

  return {
    save,
    goals: goals.data ?? [],
    action,
    extracting,
    minutes,
    changeMinutes,
    proposal,
    preference,
    setPreference,
    busy,
    error,
    stage: stageOf(action, proposal, { noSlot, unlocked, kept }),
    plan,
    book,
    moveToAlternative,
    recheck,
    done,
    skip,
    patch,
    retryExtract,
    unlock,
    keep: () => setKept(true),
    showReceipt: !!action && action.status === "planned" && !!action.block && !unlocked,
  };
}
