import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AuthLayout } from "../features/auth/AuthLayout";
import { buttonClass } from "../ui/Button";

function StatusPage({ code, title, text, children }: { code: string; title: string; text: string; children: ReactNode }) {
  return (
    <AuthLayout>
      <div role="alert" className="space-y-4">
        <p className="font-display text-small font-bold tracking-widest text-brand">ERROR {code}</p>
        <h1 className="text-title">{title}</h1>
        <p className="text-muted">{text}</p>
        <div className="flex flex-wrap items-center gap-3 pt-2">{children}</div>
      </div>
    </AuthLayout>
  );
}

// Only a page inside the app is ever used as the place to go back to.
function backTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && from !== "/500" ? from : "/app";
}

// Shown when the server or API cannot be reached or fails while the app opens, and when a page crashes.
// "Try again" is a full page load, so the session and every request start fresh.
export function ServerError({ from }: { from?: string }) {
  const location = useLocation();
  const back = from ?? backTarget(location.state);
  return (
    <StatusPage code="500" title="Something went wrong on our side" text="We could not load the app. Try again in a moment.">
      <a href={back} className={buttonClass("primary")}>Try again</a>
      <Link to="/" className={buttonClass("secondary")}>Back to home</Link>
    </StatusPage>
  );
}

export function NotFound() {
  return (
    <StatusPage code="404" title="We could not find this page" text="The address may be wrong, or the page may have moved.">
      <Link to="/app" className={buttonClass("primary")}>Open the app</Link>
      <Link to="/" className={buttonClass("secondary")}>Back to home</Link>
    </StatusPage>
  );
}
