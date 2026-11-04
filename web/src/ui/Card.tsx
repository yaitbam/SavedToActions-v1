import type { HTMLAttributes } from "react";
import { cx } from "./cx";

interface CardProps extends HTMLAttributes<HTMLElement> {
  // Saved note cards (the ones with a screenshot) get the ink border and hard shadow.
  note?: boolean;
  // Padding utility. Passed here, not in className, so it cannot lose to the default.
  pad?: string;
}

export function Card({ note = false, pad = "p-6", className, ...rest }: CardProps) {
  return (
    <section
      className={cx(
        "rounded-card bg-surface",
        pad,
        note ? "border-[1.5px] border-ink shadow-hard" : "border border-line",
        className,
      )}
      {...rest}
    />
  );
}
