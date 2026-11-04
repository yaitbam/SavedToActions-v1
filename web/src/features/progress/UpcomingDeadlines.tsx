import { Link } from "react-router-dom";
import type { HomeSummary } from "../../api/types";
import { Card } from "../../ui/Card";
import { Chip } from "../../ui/Chip";
import { StatusChip, statusFromCheck } from "../../ui/StatusChip";

export function UpcomingDeadlines({ actions }: { actions: HomeSummary[] }) {
  const deadlines = actions.filter((action) => action.deadline !== null);
  return (
    <Card className="space-y-3" pad="p-5">
      <h2 className="text-base">Upcoming deadlines</h2>
      {deadlines.length ? (
        <ul className="divide-y divide-line">
          {deadlines.map((action) => (
            <li key={action.id}>
              <Link to={`/app/saves/${action.saveId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  {action.title ? <p className="font-medium">{action.title}</p> : <Chip tone="missing">Missing</Chip>}
                  <p className="text-small text-muted">{action.deadline?.relative ?? action.deadline?.display}</p>
                  {action.isDemo && <p className="text-small text-muted">Imported demo data</p>}
                </div>
                <StatusChip status={action.status === "planned"
                  ? action.check ? statusFromCheck(action.check.state) : "planned"
                  : action.status === "open" ? "review" : action.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-small text-muted">No upcoming deadlines</p>}
    </Card>
  );
}
