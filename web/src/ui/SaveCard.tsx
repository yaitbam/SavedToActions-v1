import { Link } from "react-router-dom";
import { Card } from "./Card";
import { SaveSummary } from "./SaveSummary";
import type { StatusKey } from "./StatusChip";
import { Thumb } from "./Thumb";

interface SaveCardProps {
  saveId: number;
  screenshotUrl: string;
  title: string | null;
  goalId: number | null;
  goalName?: string | null;
  status: StatusKey | null;
  when?: string | null;
}

// Every save card is a note card: ink border and hard offset shadow around the real screenshot.
export function SaveCard({ saveId, screenshotUrl, title, goalId, goalName, status, when }: SaveCardProps) {
  return (
    <Link to={`/app/saves/${saveId}`} className="block rounded-card">
      <Card note pad="p-3" className="space-y-3 transition-transform duration-150 hover:-translate-y-0.5">
        <Thumb src={screenshotUrl} alt={`Screenshot of ${title ?? "a saved post"}`} />
        <div className="space-y-2 px-1 pb-1">
          <SaveSummary title={title} goalId={goalId} goalName={goalName} status={status} />
          {when && <p className="text-small text-muted">{when}</p>}
        </div>
      </Card>
    </Link>
  );
}
