import { useMemo, useState } from "react";
import { listActions } from "../api/actions";
import { getGoals } from "../api/goals";
import { useAsync } from "../api/useAsync";
import { Inspector } from "../features/saves/Inspector";
import { filters, loadSaves, matchesSave, type SaveFilter } from "../features/saves/model";
import { TriageCard } from "../features/saves/TriageCard";
import "../features/saves/saves.css";
import { Chip } from "../ui/Chip";
import { ErrorState } from "../ui/ErrorState";
import { Skeleton } from "../ui/Skeleton";
import { cx, fieldClass } from "../ui/cx";

interface Due { saveId: number; title: string | null; utc: string; display: string }

export function Saves() {
  const saves = useAsync(async () => {
    const [items, goals] = await Promise.all([loadSaves(), getGoals()]);
    return { items, goals };
  }, []);
  // The server decides what "this week" means in the user's timezone. The browser does no date math.
  const week = useAsync(async () => {
    try { return await listActions({ saved: "week", limit: 100 }); } catch { return null; }
  }, []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SaveFilter>("All");
  const [onlyDue, setOnlyDue] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const items = saves.data?.items ?? [];
  const open = (status?: string) => status === "open" || status === "planned";
  const due = useMemo<{ list: Due[]; scope: "week" | "all" }>(() => {
    const toDue = (saveId: number, title: string | null, deadline: { utc: string; display: string }): Due => ({ saveId, title, utc: deadline.utc, display: deadline.display });
    const weekItems = week.data?.items;
    const source: Due[] = weekItems
      ? weekItems.filter((a) => a.deadline && open(a.status)).map((a) => toDue(a.saveId, a.title, a.deadline!))
      : items.filter((s) => s.action?.deadline && open(s.action.status)).map((s) => toDue(s.saveId, s.action!.title, s.action!.deadline!));
    return { list: source.sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc)), scope: weekItems ? "week" : "all" };
  }, [week.data, items]);
  const dueIds = useMemo(() => new Set(due.list.map((d) => d.saveId)), [due]);

  const visible = items.filter((save) => matchesSave(save, filter, query) && (!onlyDue || dueIds.has(save.saveId)));
  const selected = items.find((save) => save.saveId === selectedId) ?? null;
  const goalName = (id: number | null | undefined) => saves.data?.goals.find((goal) => goal.id === id)?.name;
  const demoCount = items.filter((save) => save.isDemo).length;
  const toggle = (id: number) => setSelectedId((current) => (current === id ? null : id));

  return (
    <div className="triage-page">
      <header className="triage-head">
        <div>
          <h1 className="text-title">Saved</h1>
          <p className="triage-sub">
            {saves.data ? <span role="status">{visible.length} of {items.length} saves</span> : "Loading your saves"}
            {demoCount > 0 && <Chip tone="accent">{demoCount} demo fixtures loaded</Chip>}
          </p>
        </div>
      </header>

      {saves.data && due.list.length > 0 && (
        <div className="due-strip" role="region" aria-label="Upcoming deadlines">
          <span className="due-bolt" aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path d="M11.3 1.5 3.5 11h5.2l-1 7.5L16 8.7h-5.3l.6-7.2z" /></svg></span>
          <p><strong>{due.list.length} {due.list.length === 1 ? "save has" : "saves have"} {due.scope === "week" ? "an upcoming deadline this week" : "an extracted deadline"}</strong>
            <span>Next: {due.list[0].title ?? "Missing"} <code>{due.list[0].display}</code></span></p>
          <button type="button" aria-pressed={onlyDue} onClick={() => setOnlyDue((value) => !value)}>{onlyDue ? "Show all" : "Show them"}</button>
        </div>
      )}

      <div className="triage-tools">
        <label className="w-full md:max-w-sm">
          <span className="sr-only">Search saves</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saves" className={fieldClass} />
        </label>
        <div role="group" aria-label="Filter saves" className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}
              className={cx("min-h-10 rounded-full border px-4 text-small font-semibold", filter === item ? "border-ink bg-ink text-surface" : "border-line bg-surface")}>
              {item}
            </button>
          ))}
        </div>
      </div>

      {saves.error ? (
        <ErrorState title="Could not load your saves" error={saves.error} onRetry={() => void saves.reload()} />
      ) : !saves.data ? (
        <div className="masonry">{[300, 420, 360, 440, 320, 400, 380, 300].map((height, id) => <Skeleton key={id} className="mb-4" style={{ height }} />)}</div>
      ) : (
        <div className={cx("triage-split", selected && "with-drawer")}>
          <div className="triage-list">
            {visible.length ? (
              <div className="masonry">
                {visible.map((save) => <TriageCard key={save.saveId} save={save} goalName={goalName(save.action?.goalId)} selected={save.saveId === selectedId} onSelect={() => toggle(save.saveId)} />)}
              </div>
            ) : <p className="text-muted">{items.length ? "No saves match these filters" : "Your saved posts are waiting. Drop one to start"}</p>}
          </div>
          {selected && <Inspector save={selected} goalName={goalName(selected.action?.goalId)} onClose={() => setSelectedId(null)} />}
        </div>
      )}
    </div>
  );
}
