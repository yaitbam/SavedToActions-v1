import type { ReactNode } from "react";
import { cx } from "./cx";

interface InlineAlertProps {
  // Optional control beside the message, such as Retry.
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

// For errors that belong to a spot on the page: a form field, a dialog, a broken page state.
// It stays until the cause is fixed, so it has no close button.
export function InlineAlert({ action, className, children }: InlineAlertProps) {
  return (
    <div
      role="alert"
      className={cx("flex flex-wrap items-center justify-between gap-3 rounded-card bg-nofit-bg px-4 py-3 text-small font-medium text-nofit", className)}
    >
      <p>{children}</p>
      {action}
    </div>
  );
}
