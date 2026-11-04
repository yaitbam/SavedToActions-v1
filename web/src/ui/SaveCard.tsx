import { Link } from "react-router-dom";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { GoalChip } from "./GoalChip";
import { StatusChip, type StatusKey } from "./StatusChip";
import { Thumb } from "./Thumb";

interface SaveCardProps {
  saveId: number;
  screenshotUrl: string;
  title: string | null;
  goalId: number | null;
  goalName?: string | null;
  status: StatusKey | null;
  when?: string | null;
  demo?: boolean;
}

// Every save card is a note card: ink border and hard offset shadow around the real screenshot.
export function SaveCard({ saveId, screenshotUrl, title, goalId, goalName, status, when, demo }: SaveCardProps) {
  return (
    <Link to={`/app/saves/${saveId}`} className="block rounded-card">
      <Card note className="space-y-3 p-3 transition-transform duration-150 hover:-translate-y-0.5">
        <Thumb src={screenshotUrl} alt={`Screenshot of ${title ?? "a saved post"}`} />
        <div className="space-y-2 px-1 pb-1">
          {title ? <p className="line-clamp-2 font-semibold">{title}</p> : <Chip tone="missing">Missing</Chip>}
          <div className="flex flex-wrap gap-2">
            <GoalChip goalId={goalId} name={goalName} />
            {status && <StatusChip status={status} />}
          </div>
          {(when || demo) && (
            <p className="text-small text-muted">{[when, demo ? "Imported demo data" : null].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      </Card>
    </Link>
  );
}
