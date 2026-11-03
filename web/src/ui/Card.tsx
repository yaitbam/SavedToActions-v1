import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx("rounded-card bg-surface p-6 shadow-card", className)} {...rest} />;
}
