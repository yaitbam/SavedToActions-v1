import { Link } from "react-router-dom";
import type { SaveListItem } from "../../api/types";
import { Card } from "../../ui/Card";
import { Chip } from "../../ui/Chip";
import { GoalChip } from "../../ui/GoalChip";
import { StatusChip } from "../../ui/StatusChip";
import { Thumb } from "../../ui/Thumb";
import { saveStatus } from "./model";

export function SavedNote({ save, goalName }: {
  save: SaveListItem;
  goalName?: string;
}) {
  return (
    <Link to={`/app/saves/${save.saveId}`} className="block h-full rounded-card">
      <Card note pad="p-3" className="flex h-full flex-col gap-3">
        <div className="relative">
          <Thumb src={save.screenshotUrl} alt={`Screenshot of ${save.action?.title ?? "a saved post"}`} />
          {save.isDemo && <span className="absolute left-2 top-2"><Chip>Demo</Chip></span>}
        </div>
        <div className="flex-1 space-y-3 px-1 pb-1">
          <p className="line-clamp-2 font-semibold">{save.action?.title ?? "Missing"}</p>
          <div className="flex flex-wrap gap-2">
            {save.action?.goalId != null && goalName && <GoalChip goalId={save.action.goalId} name={goalName} />}
            <StatusChip status={saveStatus(save)} />
          </div>
          <p className="text-small text-muted">{save.importedAtRelative ?? save.importedAtDisplay}</p>
        </div>
      </Card>
    </Link>
  );
}
