import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useModelLabel } from "../api/model";
import { enterDemo } from "../api/session";
import { errorText } from "../api/errors";
import { useSession } from "../features/auth/SessionContext";
import { useAlert } from "../ui/AlertProvider";
import { Button } from "../ui/Button";
import { InlineAlert } from "../ui/InlineAlert";
import { Logo } from "../ui/Logo";
import { GoogleIcon } from "../ui/PlatformIcons";
import "../features/auth/login.css";

const steps = ["Drop a screenshot", "Confirm the effort", "Approve a time"];

export function Login() {
  const label = useModelLabel();
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
  return <div className="lg">
    <aside className="lg-side">
      <Link to="/" aria-label="SavedToAction home"><Logo /></Link>
      <div>
        <h1>Saved is<br /><em>not done.</em></h1>
        <p className="lg-lede">Turn a screenshot of a post you saved into protected time on your calendar.</p>
        <ol className="lg-steps">{steps.map((s, i) => <li key={s}><b aria-hidden="true">{i + 1}</b>{s}</li>)}</ol>
      </div>
      <p className="lg-foot">Powered by {label}. Nothing reaches your calendar without your approval.</p>
    </aside>
    <div className="lg-main">
      <div className="lg-top"><Link to="/">← Back to home</Link></div>
      <main className="lg-card">
        <h2>Sign in</h2>
        <p className="lg-sub">Use your Google account. Signing in shares your name and email. Connecting your calendar is a separate step that you approve.</p>
        <div className="lg-actions">
          {sessionError
            ? <button type="button" className="google-btn" disabled><GoogleIcon />Continue with Google</button>
            : <a href="/auth/login/google" className="google-btn"><GoogleIcon />Continue with Google</a>}
          {session?.demo_available !== false && <>
            <p className="lg-or" aria-hidden="true">or</p>
            <Button variant="secondary" className="lg-demo" disabled={!!sessionError} onClick={() => void demo()} loading={busy}>Explore the demo</Button>
          </>}
        </div>
        {query.has("deleted") && <p role="status" className="lg-privacy">
          <b>Your account and data were deleted.</b>{query.get("deleted") === "2" && " Google did not confirm that access was revoked. You can remove SavedToAction under Third-party access in your Google Account."} Events already on your Google Calendar were kept.
        </p>}
        {(!!sessionError || query.has("error")) && <div className="lg-alerts">
          {!!sessionError && <InlineAlert action={<Button variant="secondary" onClick={() => void reload()}>Retry</Button>}>Something went wrong. Please try again</InlineAlert>}
          {query.has("error") && <InlineAlert>Sign-in did not complete. Please try again</InlineAlert>}
        </div>}
        <p className="lg-privacy"><b>Your privacy.</b> We store your name, email, uploaded screenshots and the calendar blocks we create. No scraping. You choose what to upload. <Link to="/privacy">Read more</Link></p>
      </main>
      <div className="lg-legal"><span>© 2026 SavedToAction</span><Link to="/privacy">Privacy</Link></div>
    </div>
  </div>;
}
