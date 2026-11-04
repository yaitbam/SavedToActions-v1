import type { Action, Week } from "../../api/types";
import { Card } from "../../ui/Card";
import { ErrorState } from "../../ui/ErrorState";
import { goalDotClass } from "../../ui/GoalChip";
import { Skeleton } from "../../ui/Skeleton";
import { cx } from "../../ui/cx";
import { weekRows } from "./model";

interface Props {
  week: Week | null;
  planned: Action[];
  error: unknown;
  onRetry: () => void;
}

// Our blocks only, one lane per day, colored by goal. Positions and times come from the server.
export function WeekStrip({ week, planned, error, onRetry }: Props) {
  if (!week) {
    if (error) return <ErrorState error={error} title="Could not load your week" onRetry={onRetry} />;
    return <Skeleton className="h-56" />;
  }

  const rows = weekRows(week, planned);
  if (!rows.some((row) => row.blocks.length > 0)) return null;
  const hours = week.days[0];

  return (
    <Card className="space-y-3" pad="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base">This week</h2>
        <span className="text-small text-muted">{week.weekLabel}</span>
      </div>
      <div className="flex justify-between pl-20 text-small text-muted" aria-hidden="true">
        <span>{hours.startDisplay}</span>
        <span>{hours.endDisplay}</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map(({ day, today, blocks }) => (
          <li key={day.date} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
            <span
              className={cx(
                "w-fit whitespace-nowrap text-small",
                today ? "rounded-full bg-accent px-2 font-semibold text-ink" : "text-muted",
              )}
            >
              {day.label}
            </span>
            <div className="relative h-6 rounded-md bg-bg">
              {blocks.map(({ chip, goalId, title }) => (
                <span
                  key={chip.startDisplay}
                  title={`${title} · ${chip.startDisplay}`}
                  className={cx(
                    "absolute inset-y-0.5 animate-slide-onto rounded border border-ink",
                    goalId === null ? "bg-line" : goalDotClass(goalId),
                  )}
                  style={{ left: `${chip.left}%`, width: `${Math.max(chip.width, 1.5)}%` }}
                >
                  <span className="sr-only">
                    {title}, {chip.startDisplay} to {chip.endDisplay}
                  </span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
