import { cx } from "./cx";

interface LogoProps {
  wordmark?: boolean;
  className?: string;
  // The phone top bar uses a smaller mark and name.
  compact?: boolean;
}

export function Logo({ wordmark = true, className, compact = false }: LogoProps) {
  return (
    <span className={cx("inline-flex items-center", compact ? "gap-1.5" : "gap-2", className)}>
      <svg viewBox="0 0 24 24" className={compact ? "size-6" : "size-8"} role="img" aria-label="SavedToAction">
        <rect width="24" height="24" rx="6" fill="var(--color-brand)" />
        <path d="M7 4.5h10v15l-5-3.5-5 3.5z" fill="white" />
      </svg>
      {wordmark && <span className={cx("font-display font-bold tracking-tight text-ink", compact ? "text-base" : "text-xl")}>SavedToAction</span>}
    </span>
  );
}
