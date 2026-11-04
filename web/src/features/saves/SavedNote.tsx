import { Link } from "react-router-dom";
import type { SaveListItem } from "../../api/types";
import { Card } from "../../ui/Card";
import { SaveSummary } from "../../ui/SaveSummary";
import { Thumb } from "../../ui/Thumb";
import { saveStatus } from "./model";

export function SavedNote({ save, goalName, onOpen }: {
  save: SaveListItem;
  goalName?: string;
  onOpen: () => void;
}) {
  return (
    <Card note pad="p-3" className="flex h-full flex-col gap-3">
      <Thumb src={save.screenshotUrl} alt={`Screenshot of ${save.action?.title ?? "a saved post"}`} onOpen={onOpen} />
      <Link to={`/app/saves/${save.saveId}`} className="block flex-1 space-y-3 rounded-xl px-1 pb-1">
        <SaveSummary
          title={save.action?.title ?? null}
          goalId={save.action?.goalId ?? null}
          goalName={goalName}
          status={saveStatus(save)}
          isDemo={save.isDemo}
        />
        <p className="text-small text-muted">{save.importedAtRelative ?? save.importedAtDisplay}</p>
        <span className="inline-block text-small font-semibold underline underline-offset-4">Review save</span>
      </Link>
    </Card>
  );
}
