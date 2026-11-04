import { Link } from "react-router-dom";
import type { HomeSummary } from "../../api/types";
import { Card } from "../../ui/Card";
import { SaveSummary } from "../../ui/SaveSummary";
import { Thumb } from "../../ui/Thumb";
import { summaryStatus } from "./model";

interface Props {
  action: HomeSummary;
  goalName?: string;
}

// The next planned block. The whole card opens the save. Tilted a little, like a note on a desk.
export function NextUp({ action, goalName }: Props) {
  return (
    <section className="space-y-3">
      <h2 className="text-base">Next up</h2>
      <Link to={`/app/saves/${action.saveId}`} className="block rounded-card">
        <Card note pad="p-4" className="flex gap-4 -rotate-1 transition-transform duration-150 hover:rotate-0">
          <div className="w-24 shrink-0">
            <Thumb src={action.screenshotUrl} alt={`Screenshot of ${action.title ?? "a saved post"}`} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {action.block && <p className="text-base font-semibold">{action.block.rangeRelative}</p>}
            <SaveSummary
              title={action.title}
              goalId={action.goalId}
              goalName={goalName}
              status={summaryStatus(action)}
            />
          </div>
        </Card>
      </Link>
    </section>
  );
}
