import type { Goal } from "../../api/types";
import { Card } from "../../ui/Card";
import { goalDotClass } from "../../ui/GoalChip";
import { Popover } from "../../ui/Popover";
import { cx } from "../../ui/cx";

// Counts come from database records: saves with a done action, over saves imported.
export function GoalRows({ goals }: { goals: Goal[] }) {
  return (
    <Card className="space-y-4" pad="p-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-base">Goals</h2>
        <Popover label="How we count">
          Action rate is saves you marked done divided by saves imported, per goal. Completions are self reported
        </Popover>
      </div>
      <ul className="space-y-4">
        {goals.map((goal) => {
          const { savesWithDoneAction: done, importedSaves: saved } = goal.metrics;
          const share = saved > 0 ? Math.min(100, (done / saved) * 100) : 0;
          return (
            <li key={goal.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <span aria-hidden="true" className={cx("size-3 shrink-0 rounded-full", goalDotClass(goal.id))} />
                  <span className="truncate">{goal.name}</span>
                </span>
                <span className="shrink-0 text-small text-muted">
                  {done} of {saved} done
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-line" aria-hidden="true">
                <div className={cx("h-full rounded-full", goalDotClass(goal.id))} style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
