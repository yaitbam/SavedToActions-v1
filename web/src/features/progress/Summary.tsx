import type { Insights } from "../../api/types";
import { Chip } from "../../ui/Chip";
import "../home/home.css";
import "./progress.css";

// Totals across every goal. Each tile has a shape and a word, never color alone.
export function Summary({ totals }: { totals: Insights["totals"] }) {
  const tiles = [
    { cls: "", label: "Imported saves", value: totals.importedSaves, note: "Screenshots you brought in" },
    { cls: "is-planned", label: "Marked done", value: totals.markedDone, note: "Self reported completions" },
    { cls: "is-todo", label: "Action rate", value: totals.actionRate === null ? null : `${Math.round(totals.actionRate * 100)}%`, note: "Saves done over saves imported" },
    { cls: "is-time", label: "Time scheduled", value: totals.timeScheduledMin, unit: "min", note: "Active blocks, counted once" },
    { cls: "is-missed", label: "Missed deadlines", value: totals.deadlinePassedWithoutCompletion, note: "Passed without completion" },
  ];
  return (
    <div className="pg-summary" role="group" aria-label="Totals">
      {tiles.map((tile) => (
        <div key={tile.label} className={`hm-tile ${tile.cls}`}>
          <span className="hm-tile-label"><i aria-hidden="true" />{tile.label}</span>
          <b>
            {tile.value === null ? <Chip tone="missing">Missing</Chip> : tile.value}
            {tile.unit && tile.value !== null && <small>{tile.unit}</small>}
          </b>
          <small>{tile.note}</small>
        </div>
      ))}
    </div>
  );
}
