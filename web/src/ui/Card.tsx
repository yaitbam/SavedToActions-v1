import type { HTMLAttributes } from "react";
import { cx } from "./cx";

interface CardProps extends HTMLAttributes<HTMLElement> {
  // Kept for call sites that mark saved note cards. Every card shares the same elevation.
  note?: boolean;
  // Padding utility. Passed here, not in className, so it cannot lose to the default.
  pad?: string;
}

export function Card({ note: _note = false, pad = "p-6", className, ...rest }: CardProps) {
  return (
    <section
      className={cx(
        "rounded-card bg-surface",
        pad,
        "border border-line shadow-card",
        className,
      )}
      {...rest}
    />
  );
}
