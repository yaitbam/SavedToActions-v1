import { useState } from "react";
import { cx } from "../../ui/cx";

const presets = [15, 30, 45, 60, 90];

interface Props {
  minutes: number | null;
  disabled?: boolean;
  onChange: (minutes: number | null) => void;
}

const chip =
  "inline-flex h-12 items-center rounded-full border px-5 text-base font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60";

export function EffortChips({ minutes, disabled, onChange }: Props) {
  const [custom, setCustom] = useState(false);
  const showCustom = custom || (minutes !== null && !presets.includes(minutes));

  return (
    <div role="radiogroup" aria-label="Minutes" className="flex flex-wrap items-center gap-2">
      {presets.map((value) => {
        const selected = !showCustom && minutes === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => {
              setCustom(false);
              onChange(value);
            }}
            className={cx(chip, selected ? "border-ink bg-accent text-ink" : "border-line bg-surface text-ink hover:border-ink")}
          >
            {value} min
          </button>
        );
      })}
      <button
        type="button"
        role="radio"
        aria-checked={showCustom}
        disabled={disabled}
        onClick={() => setCustom(true)}
        className={cx(chip, showCustom ? "border-ink bg-accent text-ink" : "border-line bg-surface text-ink hover:border-ink")}
      >
        Custom
      </button>
      {showCustom && (
        <label className="inline-flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={1440}
            inputMode="numeric"
            aria-label="Custom minutes"
            disabled={disabled}
            value={minutes ?? ""}
            onChange={(event) => {
              const value = Number(event.target.value);
              onChange(Number.isInteger(value) && value >= 1 && value <= 1440 ? value : null);
            }}
            className="h-10 w-24 rounded-xl border border-line bg-surface px-3 text-base"
          />
          <span className="text-small text-muted">min</span>
        </label>
      )}
    </div>
  );
}
