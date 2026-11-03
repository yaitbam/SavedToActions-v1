import { cx } from "./cx";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("animate-pulse rounded-thumb bg-line motion-reduce:animate-none", className)}
    />
  );
}
