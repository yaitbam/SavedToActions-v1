import type { Action, Week } from "../../api/types";
import { ErrorState } from "../../ui/ErrorState";
import { Skeleton } from "../../ui/Skeleton";
import { cx } from "../../ui/cx";
import { weekRows } from "./model";
import "./home.css";

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
    <section className="hm-card" aria-labelledby="week-title">
      <div className="hm-head">
        <h2 id="week-title">This week</h2>
        <span className="hm-sub">{week.weekLabel}</span>
      </div>
      <div className="hm-ends" aria-hidden="true">
        <span>{hours.startDisplay}</span>
        <span>{hours.endDisplay}</span>
      </div>
      <ul className="hm-days">
        {rows.map(({ day, today, blocks }) => (
          <li key={day.date} className={cx("hm-day", today && "is-today")}>
            <span className="hm-day-label">{day.label}</span>
            <div className="hm-track">
              {blocks.map(({ chip, title }) => (
                <span
                  key={chip.startDisplay}
                  title={`${title} · ${chip.startDisplay}`}
                  className="absolute inset-y-1 animate-slide-onto rounded-md border border-brand bg-accent"
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
    </section>
  );
}
