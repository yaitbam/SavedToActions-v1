import type { CSSProperties } from "react";
import { cx } from "./cx";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cx("animate-pulse rounded-thumb bg-line motion-reduce:animate-none", className)}
    />
  );
}
