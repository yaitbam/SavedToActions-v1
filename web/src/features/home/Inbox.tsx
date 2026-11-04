import { Link } from "react-router-dom";
import type { HomeRecentSave } from "../../api/types";
import { SaveSummary } from "../../ui/SaveSummary";
import { Thumb } from "../../ui/Thumb";

interface Props {
  saves: HomeRecentSave[];
  total: number;
  goalName: (goalId: number | null | undefined) => string | undefined;
}

const VISIBLE = 3;

// Saves that still need a goal or minutes. Compact rows, so the page stays on one screen.
export function Inbox({ saves, total, goalName }: Props) {
  return (
    <section className="space-y-3">
      <h2 className="text-base">
        Needs a goal or minutes <span className="text-small font-medium text-muted">{total}</span>
      </h2>
      <ul className="space-y-2">
        {saves.slice(0, VISIBLE).map((save) => {
          const action = save.action;
          if (!action) return null;
          return (
            <li key={save.saveId}>
              <Link
                to={`/app/saves/${save.saveId}`}
                className="flex items-center gap-3 rounded-card border border-line bg-surface p-2 transition-colors duration-150 hover:border-ink"
              >
                <div className="w-10 shrink-0">
                  <Thumb src={save.screenshotUrl} alt={`Screenshot of ${action.title ?? "a saved post"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <SaveSummary
                    lines={1}
                    title={action.title}
                    goalId={action.goalId}
                    goalName={goalName(action.goalId)}
                    status={null}
                    isDemo={save.isDemo}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {total > VISIBLE && (
        <Link to="/app/saves" className="inline-block text-small font-medium underline underline-offset-4">
          See all {total}
        </Link>
      )}
    </section>
  );
}
