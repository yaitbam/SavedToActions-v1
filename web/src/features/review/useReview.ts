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
import { ApiError } from "../../api/client";
import { errorText } from "../../api/errors";
import { getGoals } from "../../api/goals";
import { confirmEffort, getSave, retryExtraction, saveLink } from "../../api/saves";
import type { Action, ActionPatch, AgentPlan, ProposeIntent, ProposeResult } from "../../api/types";
import { useAsync } from "../../api/useAsync";
import { useAlert } from "../../ui/AlertProvider";
import { stageOf, type Proposal } from "./model";

const failureTitle: Record<string, string> = {
  plan: "Could not find a time",
  propose: "Could not find a time",
  another: "Could not find another time",
  link: "Could not save the link",
  book: "Could not book this time",
  recheck: "Recheck failed",
  done: "Could not mark this done",
  skip: "Could not skip this save",
  patch: "Could not save your change",
  retry: "Extraction failed",
};

export function useReview(saveId: number) {
  const save = useAsync(() => getSave(saveId), [saveId]);
  const goals = useAsync(getGoals, []);
  const [action, setAction] = useState<Action | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [noSlot, setNoSlot] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [kept, setKept] = useState(false);
  const [moved, setMoved] = useState(false);
  // Whether the time the note asked for was met, from the first proposal. Cleared once the user asks for another.
  const [intent, setIntent] = useState<ProposeIntent | null>(null);
  const [needsCalendar, setNeedsCalendar] = useState(false);
  // The minutes a time was last looked up for, so a new proposal only follows a real change.
  const [lookedUp, setLookedUp] = useState<{ id: number; minutes: number } | null>(null);
  const [preference, setPreference] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const alert = useAlert();

  const loaded = save.data?.action ?? null;
  useEffect(() => {
    setAction(loaded);
    // The user's own words come first, then the model's guess. Nothing is scheduled until they approve.
    setMinutes(loaded ? (loaded.effort.confirmedMin ?? loaded.effort.statedMin ?? loaded.effort.suggestedMin) : null);
  }, [save.data]);

  useEffect(() => {
    setProposal(null);
    setNoSlot(false);
    setUnlocked(false);
    setKept(false);
    setMoved(false);
    setIntent(null);
    setNeedsCalendar(false);
    setLookedUp(null);
  }, [saveId]);

  const extracting = !!save.data && !save.data.action && ["queued", "running"].includes(save.data.extractionStatus);
  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => void save.reload(), 2000);
    return () => clearInterval(timer);
  }, [extracting, save.reload]);

  const stage = stageOf(action, proposal, { noSlot, unlocked, kept });

  // The first thing the user sees is a time, not a form. As soon as there are minutes (from the note, the model or
  // a tap) a time is looked up, once per change. Reading the calendar writes nothing.
  useEffect(() => {
    if (!action || stage !== "effort" || !minutes || busy || needsCalendar || extracting) return;
    if (lookedUp?.id === action.id && lookedUp.minutes === minutes) return;
    const timer = setTimeout(() => {
      setLookedUp({ id: action.id, minutes });
      void findTime(minutes);
    }, 250);
    return () => clearTimeout(timer);
  }, [action?.id, stage, minutes, busy, needsCalendar, lookedUp, extracting]);

  async function run(label: string, job: () => Promise<void>) {
    setBusy(label);
    try {
      await job();
    } catch (e) {
      alert.error(errorText(e), { title: failureTitle[label] });
    } finally {
      setBusy(null);
    }
  }

  const applyPropose = (result: ProposeResult) => {
    setIntent(result.intent ?? null);
    if (result.found) setProposal({ mode: result.mode, slot: result.slot, latest: result.latestFeasibleStart });
    else setNoSlot(true);
  };

  // Looks for a time with the minutes on screen. Read only: nothing is saved and nothing is written.
  async function findTime(forMinutes: number, label = "propose", options: { notBeforeUtc?: string } = {}) {
    if (!action) return;
    setBusy(label);
    try {
      // A block that is already on the calendar is moved, and a move needs minutes that are already confirmed.
      let current = action;
      if (action.status === "planned" && action.effort.confirmedMin !== forMinutes) {
        current = await confirmEffort(saveId, forMinutes);
        setAction(current);
      }
      applyPropose(await proposeSlot(current.id, { effortMin: forMinutes, ...options }));
      setNeedsCalendar(false);
    } catch (e) {
      if (e instanceof ApiError && ["google_not_connected", "google_missing_scopes"].includes(e.code)) setNeedsCalendar(true);
      else alert.error(errorText(e), { title: failureTitle[label] });
    } finally {
      setBusy(null);
    }
  }

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

  // Asks Muse for a time that follows a sentence, such as "after 6pm". Uses the minutes on screen and one credit.
  const planWith = (text: string) =>
    run("plan", async () => {
      if (!minutes) return;
      const confirmed = await confirmEffort(saveId, minutes);
      setAction(confirmed);
      setNoSlot(false);
      setProposal(null);
      setKept(false);
      setIntent(null);
      if (text) applyAgent(await agentPlan(confirmed.id, text));
      else applyPropose(await proposeSlot(confirmed.id));
    });
  const plan = () => planWith(preference.trim());
  const askMuse = (text: string) => planWith(text.trim());

  // Calendar writes. Each one needs a click from the user in the UI.
  const book = () =>
    run("book", async () => {
      if (!action || !proposal) return;
      const { slot, mode } = proposal;
      try {
        const result =
          mode === "move"
            ? await moveBlock(action.id, slot.startUtc, slot.endUtc)
            : await approveSlot(action.id, slot.startUtc, slot.endUtc, minutes ?? undefined);
        settle(result.action);
        setMoved(mode === "move");
      } catch (e) {
        // The calendar changed since the proposal. The server sends the next free time with the 409.
        const body = e instanceof ApiError ? (e.body as { alternative?: ProposeResult } | null) : null;
        if (e instanceof ApiError && e.code === "slot_no_longer_available" && body?.alternative?.found) {
          setProposal({ mode, slot: body.alternative.slot, latest: body.alternative.latestFeasibleStart });
        }
        throw e;
      }
    });

  const moveToAlternative = () =>
    run("book", async () => {
      const alt = action?.check?.alternative;
      if (!action || !alt) return;
      settle((await moveBlock(action.id, alt.startUtc, alt.endUtc)).action);
      setMoved(true);
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
    setIntent(null);
    setLookedUp(null);
  };

  // Another free time after the one on screen. The note's own time is not asked for again.
  const anotherTime = () => {
    if (!proposal || !minutes) return Promise.resolve();
    return findTimeAfter(proposal.slot.endUtc, minutes);
  };
  async function findTimeAfter(after: string, forMinutes: number) {
    if (!action) return;
    setBusy("another");
    try {
      const result = await proposeSlot(action.id, { effortMin: forMinutes, notBeforeUtc: after });
      if (result.found) {
        setIntent(null);
        setProposal({ mode: result.mode, slot: result.slot, latest: result.latestFeasibleStart });
      } else {
        alert.warning("Nothing later fits before the deadline. Try fewer minutes.", { title: "No other time" });
      }
    } catch (e) {
      alert.error(errorText(e), { title: failureTitle.another });
    } finally {
      setBusy(null);
    }
  }

  const setLink = (link: string | null) =>
    run("link", async () => {
      const result = await saveLink(saveId, link);
      if (result.action) setAction(result.action);
      await save.reload();
    });

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
    stage,
    intent,
    needsCalendar,
    findNow: () => (minutes ? findTime(minutes) : Promise.resolve()),
    anotherTime,
    askMuse,
    setLink,
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
    moved,
  };
}
