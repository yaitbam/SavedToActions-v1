import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type Tone = "neutral" | "accent" | "fits" | "conflict" | "nofit" | "missing";

const tones: Record<Tone, string> = {
  neutral: "bg-surface text-ink border border-line",
  accent: "bg-accent text-brand",
  fits: "bg-fits-bg text-fits",
  conflict: "bg-conflict-bg text-conflict",
  nofit: "bg-nofit-bg text-nofit",
  missing: "bg-missing-bg text-missing",
};

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return (
    <span
      className={cx(
        "semantic-pill inline-flex min-h-7 items-center gap-2 whitespace-nowrap rounded-full px-3 text-small font-medium",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
