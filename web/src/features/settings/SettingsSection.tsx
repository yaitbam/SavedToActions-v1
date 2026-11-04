import type { ReactNode } from "react";
import "./settings.css";

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
}

// Title and a short explanation on the left, the controls in a card on the right.
export function SettingsSection({ title, description, children }: Props) {
  return <section className="st-sec" aria-label={title}>
    <header>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </header>
    <div className="st-card">{children}</div>
  </section>;
}
