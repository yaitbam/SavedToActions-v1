import { cx } from "./cx";

interface LogoProps {
  wordmark?: boolean;
  className?: string;
}

export function Logo({ wordmark = true, className }: LogoProps) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="size-8" role="img" aria-label="SavedToAction">
        <rect width="24" height="24" rx="6" fill="var(--color-brand)" />
        <path d="M7 4.5h10v15l-5-3.5-5 3.5z" fill="white" />
        <path
          d="M9.6 9.6l1.7 1.7 3.1-3.3"
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {wordmark && <span className="font-display text-xl font-semibold tracking-tight text-ink">SavedToAction</span>}
    </span>
  );
}
