import type { Action } from "../../api/types";
import { useSignOut } from "../auth/useSignOut";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import "./review.css";

// What the demo shows in place of the planning card: the minutes Muse suggests and what the note asked for.
// Finding a time needs a calendar, so it stays behind sign in.
export function DemoCard({ action }: { action: Action }) {
  const { signOut, signingOut } = useSignOut();
  const minutes = action.effort.statedMin ?? action.effort.suggestedMin;
  const asked = [action.intent?.label, action.intent?.minutes ? `${action.intent.minutes} min` : null].filter(Boolean) as string[];
  return (
    <section className="pc is-ready" aria-labelledby="pc-demo-title">
      <header className="pc-head">
        <p className="pc-eyebrow" id="pc-demo-title">Suggested effort</p>
      </header>
      <div className="rv-chips">
        {minutes ? <Chip>{minutes} min</Chip> : <Chip tone="missing">Missing</Chip>}
        {action.effort.label && <Chip tone="neutral">{action.effort.label}</Chip>}
        {asked.length > 0 && <Chip tone="neutral">From the note: {asked.join(" · ")}</Chip>}
      </div>
      <p className="pc-sub">This is a read only demo. Sign in and connect your calendar to find a free time for a save like this and add it with one tap.</p>
      <div className="pc-actions">
        <Button variant="primary" loading={signingOut} onClick={() => void signOut()}>Sign in to plan this</Button>
      </div>
    </section>
  );
}
