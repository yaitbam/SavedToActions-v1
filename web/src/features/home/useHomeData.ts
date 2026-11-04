import { useState } from "react";
import { listActions, recheckAll } from "../../api/actions";
import { errorText } from "../../api/errors";
import { getGoals } from "../../api/goals";
import { getHome, getWeek } from "../../api/home";
import { useAsync } from "../../api/useAsync";

// Everything Home shows, loaded in parallel, plus the "Recheck now" action.
export function useHomeData() {
  const home = useAsync(getHome, []);
  const goals = useAsync(getGoals, []);
  const planned = useAsync(() => listActions({ status: "planned", limit: 100 }), []);
  const week = useAsync(() => getWeek(), []);
  const [rechecking, setRechecking] = useState(false);
  const [recheckNote, setRecheckNote] = useState<string | null>(null);

  const reload = () => Promise.all([home.reload(), goals.reload(), planned.reload(), week.reload()]);

  // Runs the same server check as the 5 minute watcher for every planned block. Writes nothing to the calendar.
  async function recheck() {
    const ids = planned.data?.items.map((item) => item.id) ?? [];
    if (ids.length === 0) return;
    setRechecking(true);
    setRecheckNote(null);
    try {
      const { results } = await recheckAll(ids);
      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) setRecheckNote(`${failed} of ${results.length} could not be checked`);
    } catch (e) {
      setRecheckNote(errorText(e));
    } finally {
      await reload();
      setRechecking(false);
    }
  }

  return { home, goals, planned, week, reload, recheck, rechecking, recheckNote };
}
