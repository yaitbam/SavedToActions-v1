import type { Goal } from "../../api/types";
import { Card } from "../../ui/Card";
import { Chip } from "../../ui/Chip";
import { GoalChip } from "../../ui/GoalChip";

export function GoalMetrics({ goal }: { goal: Goal }) {
  const m = goal.metrics;
  const metrics = [
    ["Imported saves", m.importedSaves],
    ["Planned", m.planned],
    ["Marked done", m.markedDone],
    ["Deadline passed without completion", m.deadlinePassedWithoutCompletion],
    ["Action rate", m.actionRate === null ? null : `${Math.round(m.actionRate * 100)}%`],
    ["Time scheduled", `${m.timeScheduledMin} min`],
  ] as const;

  return (
    <Card className="space-y-4" pad="p-5">
      <h2 className="text-base"><GoalChip goalId={goal.id} name={goal.name} /></h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
        {metrics.map(([label, value]) => (
          <div key={label} className="space-y-1">
            <dt className="text-small text-muted">{label}</dt>
            <dd className="font-semibold">{value === null ? <Chip tone="missing">Missing</Chip> : value}</dd>
          </div>
        ))}
      </dl>
      {m.demoSaves > 0 && <p className="text-small text-muted">Imported demo data · {m.demoSaves} saves</p>}
    </Card>
  );
}
