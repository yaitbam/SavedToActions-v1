import type { Action, Goal } from "../../api/types";
import { Card } from "../../ui/Card";
import { Chip } from "../../ui/Chip";
import { GoalChip, goalDotClass } from "../../ui/GoalChip";
import { ModelChip } from "../../ui/ModelChip";
import { SourceChip } from "../../ui/SourceChip";
import { cx } from "../../ui/cx";

interface Props {
  action: Action;
  goals: Goal[];
  busy: boolean;
  onGoal: (goalId: number) => void;
}

const kindLabel: Record<string, string> = { try: "Try it", opportunity: "Opportunity" };

// Chip text from the server's correction warning. No offsets are computed here.
function timezoneChipText(action: Action): string | null {
  if (!action.hasTimezoneCorrection) return null;
  const warning = action.warnings.find((item) => item.code === "deadline_offset_ignored");
  const info = warning?.proposed as { modelOffset?: string; computedOffset?: string; tz?: string } | undefined;
  if (!info?.modelOffset || !info.computedOffset || !info.tz) return "Timezone corrected";
  const city = info.tz.split("/").pop()?.replaceAll("_", " ") ?? info.tz;
  return `Model wrote ${info.modelOffset} for ${city}. Corrected to ${info.computedOffset}`;
}

export function ReviewHeader({ action, goals, busy, onGoal }: Props) {
  const goal = goals.find((item) => item.id === action.goalId);
  const tzText = timezoneChipText(action);
  const kind = kindLabel[action.kind];

  return (
    <Card className="space-y-4">
      {action.isDemo && <p className="text-small text-muted">Imported demo data</p>}

      {action.title ? (
        <h1 className="text-title">{action.title}</h1>
      ) : (
        <div className="flex items-center gap-3">
          <h1 className="text-title">Title</h1>
          <Chip tone="missing">Missing</Chip>
        </div>
      )}

      {action.goalId === null ? (
        <div className="space-y-2">
          <p className="font-semibold">Which goal is this for?</p>
          <div className="flex flex-wrap gap-2">
            {goals.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => onGoal(item.id)}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-small font-medium hover:border-ink disabled:opacity-60"
              >
                <span aria-hidden="true" className={cx("size-2 rounded-full", goalDotClass(item.id))} />
                {item.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <GoalChip goalId={action.goalId} name={goal?.name} />
          {kind && <Chip>{kind}</Chip>}
        </div>
      )}

      <div className="flex items-center gap-2 text-small text-muted">
        <span>Deadline</span>
        {action.deadline ? <Chip>{action.deadline.relative}</Chip> : <Chip tone="missing">Missing</Chip>}
      </div>

      {action.evidence.quote && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-small text-muted" title={action.evidence.quote}>
            “{action.evidence.quote}”
          </p>
          <SourceChip badge={action.evidence.badge} badgeLabel={action.evidence.badgeLabel} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {action.model && <ModelChip ms={action.extractionLatencyMs} />}
        {tzText && <Chip tone="conflict">{tzText}</Chip>}
      </div>
    </Card>
  );
}
