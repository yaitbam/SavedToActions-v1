import { cx } from "./cx";

interface LogoProps {
  wordmark?: boolean;
  className?: string;
}

export function Logo({ wordmark = true, className }: LogoProps) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="size-7 text-brand" role="img" aria-label="SavedToAction">
        <path d="M6 3h12v18l-6-4-6 4z" fill="currentColor" />
        <path
          d="M9.2 9.4l2 2 3.6-3.8"
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {wordmark && <span className="font-display text-xl font-extrabold text-ink">SavedToAction</span>}
    </span>
  );
}
