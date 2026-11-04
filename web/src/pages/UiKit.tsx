import { useState, type ReactNode } from "react";
import type { Readback } from "../api/types";
import { ApiError } from "../api/client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { ErrorState } from "../ui/ErrorState";
import { GoalChip } from "../ui/GoalChip";
import { ImageViewer } from "../ui/ImageViewer";
import { Logo } from "../ui/Logo";
import { ModelChip } from "../ui/ModelChip";
import { Popover } from "../ui/Popover";
import { Receipt } from "../ui/Receipt";
import { SaveCard } from "../ui/SaveCard";
import { Skeleton } from "../ui/Skeleton";
import { SourceChip } from "../ui/SourceChip";
import { StatusChip, type StatusKey } from "../ui/StatusChip";
import { Thumb } from "../ui/Thumb";

const sample =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#FFD84D"/><rect x="32" y="48" width="336" height="28" rx="14" fill="#14110F"/><rect x="32" y="104" width="260" height="20" rx="10" fill="#14110F"/><rect x="32" y="140" width="300" height="20" rx="10" fill="#6B645C"/><rect x="32" y="176" width="200" height="20" rx="10" fill="#6B645C"/></svg>`,
  );

const statuses: StatusKey[] = ["fits", "conflict", "nofit", "done", "planned", "needs_input", "error", "drift", "missing"];
const swatches = ["bg-ink", "bg-muted", "bg-line", "bg-bg", "bg-surface", "bg-accent", "bg-fits-bg", "bg-conflict-bg", "bg-nofit-bg", "bg-missing-bg", "bg-goal-earn", "bg-goal-learn", "bg-goal-deadlines"];

const driftReadback: Readback = {
  status: "drift",
  at: null,
  atDisplay: null,
  drift: [],
  driftDisplay: [{ field: "start", expectedDisplay: "Thu 14:00", actualDisplay: "Thu 15:00" }],
  error: null,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4">
      <h2 className="font-display text-xl">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </Card>
  );
}

export function UiKit() {
  const [viewer, setViewer] = useState(false);
  return (
    <div className="space-y-6">
      <h1 className="text-title">UI check</h1>
      <Section title="Logo">
        <Logo />
        <Logo wordmark={false} />
      </Section>
      <Section title="Type">
        <p className="font-display text-title">Title 36</p>
        <p>Body 16 Inter 1234567890</p>
        <p className="text-small text-muted">Small 13 helper text</p>
      </Section>
      <Section title="Colors">
        {swatches.map((cls) => (
          <span key={cls} className={`${cls} size-10 rounded-full border border-line`} title={cls} />
        ))}
      </Section>
      <Section title="Buttons">
        <Button>Confirm 30 min and find a time</Button>
        <Button variant="secondary">Edit details</Button>
        <Button variant="text">Skip</Button>
        <Button disabled>Disabled</Button>
        <Button loading>Working</Button>
      </Section>
      <Section title="Chips">
        <Chip>Neutral</Chip>
        <Chip tone="accent">Accent</Chip>
        {statuses.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </Section>
      <Section title="Goal, source, model">
        <GoalChip goalId={1} name="Earn more" />
        <GoalChip goalId={2} name="Learn a skill" />
        <GoalChip goalId={3} name="Events and opportunities" />
        <GoalChip goalId={null} name={null} />
        <SourceChip badge="matched_note" />
        <SourceChip badge="matched_transcription" />
        <SourceChip badge="edited" />
        <ModelChip ms={4200} />
        <ModelChip />
      </Section>
      <Section title="Receipt">
        <div className="grid w-full gap-3 md:grid-cols-3">
          <Receipt range="Thu 14:00 to 14:30" readback={{ ...driftReadback, status: "ok", driftDisplay: [] }} />
          <Receipt range="Thu 14:00 to 14:30" readback={driftReadback} />
          <Receipt range="Thu 14:00 to 14:30" readback={{ ...driftReadback, status: "failed", driftDisplay: [] }} />
        </div>
      </Section>
      <Section title="Cards">
        <div className="w-56">
          <SaveCard
            saveId={0}
            screenshotUrl={sample}
            title="Sample save card"
            goalId={2}
            goalName="Learn a skill"
            status="fits"
            when="Today 18:30"
            demo
          />
        </div>
        <Card className="w-56">Flat card</Card>
      </Section>
      <Section title="Thumb, viewer, skeleton">
        <div className="w-40">
          <Thumb src={sample} alt="Sample screenshot" onOpen={() => setViewer(true)} />
        </div>
        <div className="w-40">
          <Thumb src="/missing.png" alt="Broken screenshot" />
        </div>
        <Skeleton className="h-24 w-40" />
        <ImageViewer src={sample} alt="Sample screenshot" open={viewer} onClose={() => setViewer(false)} />
      </Section>
      <Section title="Popover">
        <Popover label="How we count">
          Action rate is saves you marked done divided by saves imported, per goal. Completions are self reported
        </Popover>
      </Section>
      <ErrorState error={new ApiError(502, { error: "model_failed", detail: "Model call failed" })} onRetry={() => undefined} />
    </div>
  );
}
