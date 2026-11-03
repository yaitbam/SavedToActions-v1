import type { Readback } from "../api/types";
import { cx } from "./cx";

interface ReceiptProps {
  startDisplay: string;
  endDisplay: string;
  readback: Readback | null;
}

export function Receipt({ startDisplay, endDisplay, readback }: ReceiptProps) {
  const status = readback?.status ?? null;
  const drift = status === "drift";
  const failed = status === "failed";
  const tone = drift ? "bg-conflict-bg text-conflict" : failed ? "bg-nofit-bg text-nofit" : "bg-fits-bg text-fits";

  return (
    <div role="status" className={cx("animate-enter rounded-card p-6", tone)}>
      {(drift || failed) && <p className="font-semibold">{drift ? "Calendar changed" : "Not checked"}</p>}
      {drift ? (
        <ul className="mt-1 space-y-1">
          {readback?.driftDisplay.map((item) => (
            <li key={item.field}>
              Calendar shows {item.field} as {item.actualDisplay}. We expected {item.expectedDisplay}
            </li>
          ))}
        </ul>
      ) : failed ? (
        <p className="mt-1">Could not read the calendar back. Try Recheck now</p>
      ) : (
        <p className="mt-1">
          Booked {startDisplay} to {endDisplay}. Calendar matched start, end and timezone
        </p>
      )}
    </div>
  );
}
