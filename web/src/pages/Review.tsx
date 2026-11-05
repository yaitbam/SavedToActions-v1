import { ExtractionTelemetry } from "../ui/ExtractionTelemetry";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "../ui/ErrorState";
import { ImageViewer } from "../ui/ImageViewer";
import { Receipt } from "../ui/Receipt";
import { Skeleton } from "../ui/Skeleton";
import { Thumb } from "../ui/Thumb";
import { DeleteSave } from "../features/review/DeleteSave";
import { Details } from "../features/review/Details";
import { PlanCard } from "../features/review/PlanCard";
import { ReviewHeader } from "../features/review/ReviewHeader";
import { StateButton } from "../features/review/StateButton";
import { StateNote } from "../features/review/StateNote";
import { Step } from "../features/review/Step";
import { DemoCard } from "../features/review/DemoCard";
import { useSession } from "../features/auth/SessionContext";
import { useReview } from "../features/review/useReview";
import "../features/review/review.css";

const stepThree = {
  effort: { title: "Find a time", hint: "Confirm your minutes above, then we look for a free time" },
  proposed: { title: "Approve a time", hint: "Nothing is written to your calendar until you approve" },
  conflict: { title: "Your calendar changed", hint: "Choose what to do with this block" },
  nofit: { title: "No time fits", hint: "Change the minutes or your working hours" },
  fits: { title: "On your calendar", hint: "We keep checking that it still fits" },
  done: { title: "Done", hint: "Marked done by you" },
} as const;

export function Review() {
  const saveId = Number(useParams().id);
  const r = useReview(saveId);
  // Read only means the shared demo session. Saves imported into a real account use the normal flow.
  const demo = useSession().session?.kind === "demo";
  const [zoom, setZoom] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const save = r.save.data;
  const action = r.action;
  const openDetails = () => {
    setDetailsOpen(true);
    detailsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  if (!save) {
    if (r.save.error) {
      return <ErrorState error={r.save.error} title="Could not load this save" onRetry={() => void r.save.reload()} />;
    }
    return (
      <div className="rv-grid">
        <Skeleton className="aspect-[4/5]" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // Until a time is booked, the whole decision is one card: a time, the minutes and one button.
  const planning = r.stage === "effort" || r.stage === "proposed";
  const block = action?.block;
  const readbackStatus = block?.readback?.status;
  const three = stepThree[r.stage];

  return (
    <div className="rv">
      <div className="rv-top">
        <Link to="/app/saves" className="rv-back">← Saved</Link>
      </div>
      <div className="rv-grid">
        <aside className="rv-shot">
          <div className="rv-shot-bar">
            <span>Your screenshot</span>
            <button type="button" onClick={() => setZoom(true)}>Open full size</button>
          </div>
          <Thumb natural src={save.screenshotUrl} alt="Your saved screenshot" onOpen={() => setZoom(true)} />
          <ImageViewer src={save.screenshotUrl} alt="Your saved screenshot" open={zoom} onClose={() => setZoom(false)} />
        </aside>

        <div className="rv-main">
          {!action ? (
            r.extracting ? (
              <ExtractionTelemetry />
            ) : (
              <ErrorState title="Extraction failed" onRetry={r.retryExtract} />
            )
          ) : (
            <>
              <ReviewHeader part="title" action={action} goals={r.goals} busy={r.busy !== null} onGoal={(goalId) => r.patch({ goalId })} onDeadline={(wall) => r.patch({ deadline: { wall } })} />

              {demo ? (
                <>
                  <ReviewHeader part="read" action={action} goals={r.goals} busy readOnly onGoal={() => {}} onDeadline={() => {}} />
                  <DemoCard action={action} />
                  <Details action={action} goals={r.goals} open={detailsOpen} busy onToggle={setDetailsOpen} onPatch={r.patch} onLink={r.setLink} label="What Muse read from the image" readOnly />
                </>
              ) : planning ? (
                <>
                  <ReviewHeader
                    part="read"
                    action={action}
                    goals={r.goals}
                    busy={r.busy !== null}
                    onGoal={(goalId) => r.patch({ goalId })}
                    onDeadline={(wall) => r.patch({ deadline: { wall } })}
                    step={{ n: 1, title: "Check what Muse read", hint: "Fix anything that is wrong before you add it to your calendar", onEdit: openDetails }}
                  />
                  <div ref={detailsRef}>
                    {detailsOpen && <Details action={action} goals={r.goals} open busy={r.busy !== null} onToggle={setDetailsOpen} onPatch={r.patch} onLink={r.setLink} label="Edit details" />}
                  </div>
                  <PlanCard
                    action={action}
                    minutes={r.minutes}
                    proposal={r.proposal}
                    intent={r.intent}
                    request={r.request}
                    busy={r.busy}
                    needsCalendar={r.needsCalendar}
                    onMinutes={r.changeMinutes}
                    onBook={r.book}
                    onAnother={r.anotherTime}
                    onFind={r.findNow}
                    onAsk={r.askMuse}
                    onSkip={r.skip}
                    removed={r.removed}
                  />
                </>
              ) : (
                <>
                  <Step title={three.title} hint={three.hint} current={r.stage === "conflict" || r.stage === "nofit"}>
                    <StateNote stage={r.stage} action={action} proposal={r.proposal} minutes={r.minutes} />
                    {r.showReceipt && block && readbackStatus && (
                      <Receipt range={block.rangeRelative} readback={block.readback} moved={r.moved} />
                    )}
                    <div className="state-actions">
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
                          unplan: r.unplan,
                          otherTime: r.anotherTime,
                          editDetails: openDetails,
                        }}
                      />
                    </div>
                  </Step>

                  <ReviewHeader part="read" action={action} goals={r.goals} busy={r.busy !== null} onGoal={(goalId) => r.patch({ goalId })} onDeadline={(wall) => r.patch({ deadline: { wall } })} />

                  <div ref={detailsRef}>
                    <Details action={action} goals={r.goals} open={detailsOpen} busy={r.busy !== null} onToggle={setDetailsOpen} onPatch={r.patch} onLink={r.setLink} />
                  </div>
                </>
              )}
            </>
          )}

          {!demo && <DeleteSave saveId={saveId} booked={block?.rangeRelative ?? null} disabled={r.busy !== null || r.extracting} />}
        </div>
      </div>
    </div>
  );
}
