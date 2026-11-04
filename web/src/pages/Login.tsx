import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { enterDemo } from "../api/session";
import { errorText } from "../api/errors";
import { AuthLayout } from "../features/auth/AuthLayout";
import { useSession } from "../features/auth/SessionContext";
import { useAlert } from "../ui/AlertProvider";
import { Button, buttonClass } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";

export function Login() {
  const { session, error: sessionError, reload } = useSession();
  const [query] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const alert = useAlert();
  if (session?.authenticated) return <Navigate to={session.profile_complete || session.kind === "demo" ? "/app" : "/complete-profile"} replace />;

  async function demo() {
    setBusy(true);
    try { await enterDemo(); await reload(); }
    catch (cause) { alert.error(errorText(cause, "Could not open the demo. Try again")); }
    finally { setBusy(false); }
  }
  return <AuthLayout><div className="space-y-8">
    <div className="space-y-4"><p className="text-small text-muted">A place for what you saved</p>
      <h1 className="font-display text-4xl md:text-5xl">Saved is not done. Sign in to start</h1>
      <p className="text-muted">Your saves, your confirmed effort, your calendar.</p></div>
    <div className="flex flex-col gap-3">
      {sessionError ? <Button disabled>Continue with Google</Button> : <a href="/auth/login/google" className={buttonClass("primary")}>Continue with Google</a>}
      {session?.demo_available !== false && <Button variant="secondary" disabled={!!sessionError} onClick={() => void demo()} loading={busy}>Explore the demo</Button>}
    </div>
    {!!sessionError && <InlineAlert action={<Button variant="secondary" onClick={() => void reload()}>Retry</Button>}>Something went wrong. Please try again</InlineAlert>}
    {query.has("error") && <InlineAlert>Sign-in did not complete. Please try again</InlineAlert>}
    <Card className="space-y-3 text-small" pad="p-5">
      <h2 className="text-base">Your privacy</h2>
      <p>We store your name, email, uploaded screenshots and calendar blocks we create.</p>
      <p>No scraping. We check calendar availability to find and protect your time.</p>
      <p className="text-muted">You choose what to upload. Calendar changes need your approval.</p>
    </Card>
  </div></AuthLayout>;
}
