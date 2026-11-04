import { useState } from "react";
import { Link } from "react-router-dom";
import { getAction, moveBlock, skipAction } from "../../api/actions";
import { errorText } from "../../api/errors";
import type { HomeAttention } from "../../api/types";
import { useAsync } from "../../api/useAsync";
import { Button, buttonClass } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Chip } from "../../ui/Chip";
import { Skeleton } from "../../ui/Skeleton";
import { StatusChip } from "../../ui/StatusChip";
import { Thumb } from "../../ui/Thumb";
import { StateNote } from "../review/StateNote";
import { attentionStatus } from "./model";

interface Props {
  item: HomeAttention;
  onChanged: () => void;
}

// A save that needs a decision now. The move and skip buttons are the user's approval for that one write.
export function AttentionCard({ item, onChanged }: Props) {
  const summary = item.action;
  // The home list has no conflicts or alternative slot, so the full action is read for the two states that need them.
  const needsDetail = item.state === "amber" || (item.state === "red" && item.reason !== "deadline_passed");
  const full = useAsync(() => getAction(summary.id), [summary.id, summary.check?.id, summary.block?.id]);
  const [busy, setBusy] = useState<"move" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const action = full.data;
  const conflicting = item.state === "amber" && !!action?.check?.conflicts.length;
  const noFit = item.state === "red" && item.reason !== "deadline_passed";
  const alternative = conflicting ? (action?.check?.alternative ?? null) : null;
  const review = `/app/saves/${summary.saveId}`;

  async function run(kind: "move" | "skip", job: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await job();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  let note;
  if (needsDetail && !action) {
    note = <Skeleton className="h-20" />;
  } else if (action && conflicting) {
    note = <StateNote stage="conflict" action={action} proposal={null} minutes={null} />;
  } else if (action && noFit) {
    note = <StateNote stage="nofit" action={action} proposal={null} minutes={null} />;
  } else {
    note = (
      <div className="space-y-2 rounded-card bg-bg p-3">
        <StatusChip status={attentionStatus(item, conflicting)} />
        <p className="text-small">{item.text}</p>
      </div>
    );
  }

  return (
    <Card note pad="p-4" className="flex gap-4">
      <Link to={review} className="block w-20 shrink-0 self-start" aria-label="Open this save">
        <Thumb src={summary.screenshotUrl} alt={`Screenshot of ${summary.title ?? "a saved post"}`} />
      </Link>
      <div className="min-w-0 flex-1 space-y-3">
        {summary.title ? (
          <p className="line-clamp-2 font-semibold">{summary.title}</p>
        ) : (
          <Chip tone="missing">Missing</Chip>
        )}
        {summary.isDemo && <p className="text-small text-muted">Imported demo data</p>}
        {note}
        <div className="flex flex-wrap items-center gap-3">
          {alternative ? (
            <>
              <Button
                loading={busy === "move"}
                disabled={busy !== null}
                onClick={() => run("move", () => moveBlock(summary.id, alternative.startUtc, alternative.endUtc))}
              >
                Move to {alternative.startRelative}
              </Button>
              <Link to={review} className={buttonClass("secondary")}>
                Open save
              </Link>
            </>
          ) : (
            <>
              <Link to={review} className={buttonClass("primary")}>
                {noFit ? "Change minutes or hours" : item.state === "amber" ? "Find a new time" : "Open save"}
              </Link>
              {item.state === "red" && (
                <Button
                  variant="secondary"
                  loading={busy === "skip"}
                  disabled={busy !== null}
                  onClick={() => run("skip", () => skipAction(summary.id))}
                >
                  Skip
                </Button>
              )}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-small text-nofit">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
