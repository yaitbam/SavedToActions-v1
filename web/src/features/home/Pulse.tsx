import { Link } from "react-router-dom";
import { buttonClass } from "../../ui/Button";
import "./home.css";

interface Props {
  planned: number;
  attention: number;
  toConfirm: number;
}

// Counts from the user's own records. Each tile shows a shape and a word, never color alone.
export function Pulse({ planned, attention, toConfirm }: Props) {
  const tiles = [
    { cls: "is-planned", label: "Planned", value: planned, note: "Blocks you approved on your calendar" },
    { cls: "is-attn", label: "Need you", value: attention, note: "Waiting for a decision from you" },
    { cls: "is-todo", label: "To confirm", value: toConfirm, note: "Saves that still need minutes or a goal" },
  ];
  return (
    <div className="hm-pulse" role="group" aria-label="Summary">
      {tiles.map((tile) => (
        <Link key={tile.label} to="/app/saves" className={`hm-tile ${tile.cls}`}>
          <span className="hm-tile-label"><i aria-hidden="true" />{tile.label}</span>
          <b>{tile.value}</b>
          <small>{tile.note}</small>
        </Link>
      ))}
    </div>
  );
}

// Shown in place of the week when nothing has been planned yet.
export function NoPlan() {
  return (
    <section className="hm-empty">
      <h2>Nothing planned this week</h2>
      <p>Open a save, confirm how long it takes and approve a time. It shows up here once it is on your calendar.</p>
      <Link to="/app/saves" className={buttonClass("secondary")}>Open your saves</Link>
    </section>
  );
}
