import { getSession } from "../../api/session";
import { useAsync } from "../../api/useAsync";

// compact: one small pill for the new save dialog. Without it, the longer note used in Settings.
export function Credits({ compact = false }: { compact?: boolean }) {
  const current = useAsync(getSession, []);
  const credits = current.data?.credits;
  if (compact) {
    if (!credits) return null;
    return <span className={`ns-credits${credits.remaining === 0 ? " is-empty" : ""}`} title="1 credit per Muse read. Resets at 00:00">
      {credits.remaining === 0 ? "No credits left today" : `${credits.remaining} of ${credits.max} credits today`}
    </span>;
  }
  return <div className="space-y-2 text-small text-muted">
    <p>{credits?.display ?? "Credits unavailable"}</p>
    {credits?.remaining === 0 && <p>No free credits left today. They reset at 00:00</p>}
    <p>1 credit per Muse read. Resets at 00:00</p>
  </div>;
}
