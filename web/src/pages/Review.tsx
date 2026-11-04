import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "../ui/Card";
import { ErrorState } from "../ui/ErrorState";
import { ImageViewer } from "../ui/ImageViewer";
import { Receipt } from "../ui/Receipt";
import { Skeleton } from "../ui/Skeleton";
import { Thumb } from "../ui/Thumb";
import { fieldClass } from "../ui/cx";
import { Details } from "../features/review/Details";
import { EffortChips } from "../features/review/EffortChips";
import { ReviewHeader } from "../features/review/ReviewHeader";
import { StateButton } from "../features/review/StateButton";
import { StateNote } from "../features/review/StateNote";
import { useReview } from "../features/review/useReview";

export function Review() {
  const saveId = Number(useParams().id);
  const r = useReview(saveId);
  const [zoom, setZoom] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const preferenceRef = useRef<HTMLTextAreaElement>(null);
  const save = r.save.data;
  const action = r.action;

  if (!save) {
    if (r.save.error) {
      return <ErrorState error={r.save.error} title="Could not load this save" onRetry={() => void r.save.reload()} />;
    }
    return (
      <div className="grid gap-6 md:grid-cols-[5fr_6fr]">
        <Skeleton className="aspect-[4/5]" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const editable = r.stage === "effort" || r.stage === "proposed";
  const effort = action?.effort;
  const yourEstimate = !!effort && r.minutes !== null && (effort.confirmed || r.minutes !== effort.suggestedMin);
  const estimateNote = r.minutes === null ? null : yourEstimate ? "Your estimate" : "Model estimate";
  const block = action?.block;
  const readbackStatus = block?.readback?.status;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-start">
      <Card note className="p-3 md:sticky md:top-6">
        <Thumb natural src={save.screenshotUrl} alt="Your saved screenshot" onOpen={() => setZoom(true)} />
        <ImageViewer src={save.screenshotUrl} alt="Your saved screenshot" open={zoom} onClose={() => setZoom(false)} />
      </Card>

      <div className="min-w-0 space-y-6">
        {!action ? (
          r.extracting ? (
            <Card role="status" className="space-y-3">
              <p className="font-semibold">Muse Spark Open is reading your screenshot</p>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </Card>
          ) : (
            <ErrorState title="Extraction failed" error={r.error ? new Error(r.error) : undefined} onRetry={r.retryExtract} />
          )
        ) : (
          <>
            <ReviewHeader action={action} goals={r.goals} busy={r.busy !== null} onGoal={(goalId) => r.patch({ goalId })} />

            <Card className="space-y-4">
              <div className="space-y-1">
                <h2 className="font-display text-base">How long will this take you?</h2>
                {estimateNote && <p className="text-small text-muted">{estimateNote}</p>}
              </div>
              <EffortChips minutes={r.minutes} disabled={!editable || r.busy !== null} onChange={r.changeMinutes} />

              {editable && (
                <label className="block space-y-1">
                  <span className="text-small text-muted">Any preference? (optional)</span>
                  <textarea
                    ref={preferenceRef}
                    value={r.preference}
                    onChange={(event) => r.setPreference(event.target.value)}
                    rows={2}
                    className={`${fieldClass} h-auto resize-none py-3`}
                  />
                </label>
              )}

              <StateNote stage={r.stage} action={action} proposal={r.proposal} minutes={r.minutes} />
              {r.error && (
                <p role="alert" className="text-small text-nofit">
                  {r.error}
                </p>
              )}
              <StateButton
                stage={r.stage}
                action={action}
                proposal={r.proposal}
                minutes={r.minutes}
                busy={r.busy}
                on={{
                  plan: r.plan,
                  book: r.book,
                  done: r.done,
                  recheck: r.recheck,
                  moveToAlternative: r.moveToAlternative,
                  keep: r.keep,
                  unlock: r.unlock,
                  skip: r.skip,
                  otherTime: () => (r.preference.trim() ? r.plan() : preferenceRef.current?.focus()),
                  editDetails: () => {
                    setDetailsOpen(true);
                    detailsRef.current?.scrollIntoView({ block: "nearest" });
                  },
                }}
              />
            </Card>

            {r.showReceipt && block && readbackStatus && <Receipt range={block.rangeRelative} readback={block.readback} />}

            <div ref={detailsRef}>
              <Details
                action={action}
                goals={r.goals}
                open={detailsOpen}
                busy={r.busy !== null}
                onToggle={setDetailsOpen}
                onPatch={r.patch}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
