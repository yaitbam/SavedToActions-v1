import type { HTMLAttributes } from "react";
import { cx } from "./cx";

interface CardProps extends HTMLAttributes<HTMLElement> {
  // Saved note cards (the ones with a screenshot) get the ink border and hard shadow.
  note?: boolean;
}

export function Card({ note = false, className, ...rest }: CardProps) {
  return (
    <section
      className={cx(
        "rounded-card bg-surface p-6",
        note ? "border-[1.5px] border-ink shadow-hard" : "border border-line",
        className,
      )}
      {...rest}
    />
  );
}
