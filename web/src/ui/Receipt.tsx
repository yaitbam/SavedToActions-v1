import type { Readback } from "../api/types";
import { cx } from "./cx";

interface ReceiptProps {
  // The server's rangeRelative string, shown as is.
  range: string;
  readback: Readback | null;
  moved?: boolean;
}

// The calendar read back after a write. A word and a shape say what happened, color only supports it.
export function Receipt({ range, readback, moved = false }: ReceiptProps) {
  const status = readback?.status ?? null;
  const drift = status === "drift";
  const failed = status === "failed" || status === null;

  return (
    <div role="status" className={cx("rv-note animate-enter", drift ? "is-conflict" : failed ? "is-nofit" : "is-verified")}>
      <span className="rv-note-label"><i aria-hidden="true" />{drift ? "Calendar changed" : failed ? "Not checked" : moved ? "Moved and checked" : "Booked and checked"}</span>
      {drift ? (
        <ul className="space-y-1">
          {readback?.driftDisplay.map((item) => (
            <li key={item.field}>
              Calendar shows {item.field} as {item.actualDisplay}. We expected {item.expectedDisplay}
            </li>
          ))}
        </ul>
      ) : failed ? (
        <p>Could not read the calendar back. Try Recheck now</p>
      ) : (
        <>
          <p className="rv-time">{range}</p>
          <p>Calendar matched start, end and timezone</p>
        </>
      )}
    </div>
  );
}
