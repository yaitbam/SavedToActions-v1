import { getSession } from "../../api/session";
import { useAsync } from "../../api/useAsync";
export function Credits() {
  const current = useAsync(getSession, []);
  const credits = current.data?.credits;
  return <div className="space-y-2 text-small text-muted">
    <p>{credits?.display ?? "Credits unavailable"}</p>
    {credits?.remaining === 0 && <p>No free credits left today. They reset at 00:00</p>}
    <p>1 credit per Muse Spark Open read. Resets at 00:00</p>
  </div>;
}
