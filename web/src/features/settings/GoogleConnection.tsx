import { useSession } from "../auth/SessionContext";
import { useState } from "react";
import { disconnectGoogle, getAuthStatus, googleConnectUrl } from "../../api/auth";
import { errorText } from "../../api/errors";
import type { AuthStatus } from "../../api/types";
import { useAsync } from "../../api/useAsync";
import { useAlert } from "../../ui/AlertProvider";
import { InlineAlert } from "../../ui/InlineAlert";
import { Button, buttonClass } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { ErrorState } from "../../ui/ErrorState";
import { GoogleIcon } from "../../ui/PlatformIcons";
import { Skeleton } from "../../ui/Skeleton";
import { SettingsSection } from "./SettingsSection";

const TITLE = "Google Calendar";
const ABOUT = "Used to find free time and to place the blocks you approve.";

export function GoogleConnection() {
  const { session } = useSession();
  const auth = useAsync(getAuthStatus, []);
  const [changed, setChanged] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const alert = useAlert();
  const status = changed ?? auth.data;

  async function disconnect() {
    setBusy(true);
    try {
      setChanged(await disconnectGoogle());
    } catch (cause) {
      alert.error(errorText(cause, "Could not disconnect Google Calendar. Try again"));
    } finally {
      setBusy(false);
    }
  }

  if (session?.kind === "demo") return <SettingsSection title={TITLE} description={ABOUT}><p className="st-note">Sign in to do this</p></SettingsSection>;
  if (auth.error) return <div className="border-t border-line py-8"><ErrorState title="Could not load Google connection" error={auth.error} onRetry={() => void auth.reload()} /></div>;
  if (!status) return <div className="border-t border-line py-8"><Skeleton className="h-48" /></div>;

  const calendarResult = new URLSearchParams(window.location.search).get("google");
  const partial = status.missingScopes.length > 0;
  return (
    <SettingsSection title={TITLE} description={ABOUT}>
      {calendarResult === "wrong_account" && <InlineAlert>Connect the Google account you signed in with</InlineAlert>}
      {calendarResult === "error" && <InlineAlert>Something went wrong. Please try again</InlineAlert>}
      <div role="status" className="st-status">
        <Chip tone={partial ? "conflict" : status.connected ? "fits" : "missing"}>
          {partial ? "Permissions needed" : status.connected ? session?.calendar_email ? `Connected as ${session.calendar_email}` : "Connected" : "Not connected"}
        </Chip>
      </div>
      <p className="st-note">
        {!status.configured ? "Google Calendar connection is not configured on the server"
          : partial ? "Reconnect to grant the calendar permissions needed for booking"
          : "You approve every calendar booking and move"}
      </p>
      <div className="st-actions">
        {status.configured && (!status.connected || partial) && (
          <a href={googleConnectUrl} className={buttonClass("secondary")}><GoogleIcon width={20} height={20} />{partial ? "Reconnect Google Calendar" : "Connect Google Calendar"}</a>
        )}
        {(status.connected || status.hasRefreshToken) && (
          <Button variant="secondary" loading={busy} onClick={() => void disconnect()}>Disconnect Google Calendar</Button>
        )}
      </div>
    </SettingsSection>
  );
}
