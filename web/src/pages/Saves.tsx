import { useState } from "react";
import { getGoals } from "../api/goals";
import type { SaveListItem } from "../api/types";
import { useAsync } from "../api/useAsync";
import { filters, loadSaves, matchesSave, type SaveFilter } from "../features/saves/model";
import { SavedNote } from "../features/saves/SavedNote";
import { ErrorState } from "../ui/ErrorState";
import { ImageViewer } from "../ui/ImageViewer";
import { Skeleton } from "../ui/Skeleton";
import { cx, fieldClass } from "../ui/cx";

export function Saves() {
  const saves = useAsync(async () => {
    const [items, goals] = await Promise.all([loadSaves(), getGoals()]);
    return { items, goals };
  }, []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SaveFilter>("All");
  const [viewer, setViewer] = useState<SaveListItem | null>(null);
  const visible = saves.data?.items.filter((save) => matchesSave(save, filter, query)) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-title">Saves</h1>
      <div className="flex flex-wrap items-center gap-4">
        <label className="w-full md:max-w-sm">
          <span className="sr-only">Search saves</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saves" className={fieldClass} />
        </label>
        <div role="group" aria-label="Filter saves" className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}
              className={cx("min-h-10 rounded-full border px-4 text-small font-semibold",
                filter === item ? "border-ink bg-accent" : "border-line bg-surface")}>
              {item}
            </button>
          ))}
        </div>
      </div>
      {saves.error ? (
        <ErrorState title="Could not load your saves" error={saves.error} onRetry={() => void saves.reload()} />
      ) : !saves.data ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((id) => <Skeleton key={id} className="h-96" />)}
        </div>
      ) : (
        <>
          <p role="status" className="text-small text-muted">{visible.length} of {saves.data.items.length} saves</p>
          {visible.length ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {visible.map((save) => (
                <SavedNote key={save.saveId} save={save} onOpen={() => setViewer(save)}
                  goalName={saves.data?.goals.find((goal) => goal.id === save.action?.goalId)?.name} />
              ))}
            </div>
          ) : <p className="text-muted">{saves.data.items.length ? "No saves match these filters" : "Your saved posts are waiting. Drop one to start"}</p>}
        </>
      )}
      {viewer && <ImageViewer src={viewer.screenshotUrl} alt="Your saved screenshot" open onClose={() => setViewer(null)} />}
    </div>
  );
}
