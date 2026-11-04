import type { ReactNode } from "react";
import { cx } from "../../ui/cx";
import "./review.css";

interface Props {
  n?: number;
  title: string;
  hint?: string;
  // The step the user should act on now. Shown with a ring and the words "Do this now".
  current?: boolean;
  children: ReactNode;
}

export function Step({ n, title, hint, current = false, children }: Props) {
  return (
    <section className={cx("rv-step", current && "is-current")} aria-label={n ? `Step ${n}: ${title}` : title}>
      <header className="rv-step-head">
        {n !== undefined && <span className="rv-n" aria-hidden="true">{n}</span>}
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {current && <span className="rv-now">Do this now</span>}
      </header>
      {children}
    </section>
  );
}
