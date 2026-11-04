import { useState } from "react";
import { disconnectGoogle, getAuthStatus, googleConnectUrl } from "../../api/auth";
import { errorText } from "../../api/errors";
import type { AuthStatus } from "../../api/types";
import { useAsync } from "../../api/useAsync";
import { Button, buttonClass } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Chip } from "../../ui/Chip";
import { ErrorState } from "../../ui/ErrorState";
import { Skeleton } from "../../ui/Skeleton";

export function GoogleConnection() {
  const auth = useAsync(getAuthStatus, []);
  const [changed, setChanged] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = changed ?? auth.data;

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      setChanged(await disconnectGoogle());
    } catch (cause) {
      setError(errorText(cause, "Could not disconnect Google Calendar. Try again"));
    } finally {
      setBusy(false);
    }
  }

  if (auth.error) return <ErrorState title="Could not load Google connection" error={auth.error} onRetry={() => void auth.reload()} />;
  if (!status) return <Skeleton className="h-48" />;

  const partial = status.missingScopes.length > 0;
  return (
    <Card className="space-y-4">
      <h2 className="text-base">Google Calendar</h2>
      <div role="status">
        <Chip tone={partial ? "conflict" : status.connected ? "fits" : "missing"}>
          {partial ? "Permissions needed" : status.connected ? "Connected" : "Not connected"}
        </Chip>
      </div>
      <p className="text-small text-muted">
        {!status.configured ? "Google Calendar connection is not configured on the server"
          : partial ? "Reconnect to grant the calendar permissions needed for booking"
          : "You approve every calendar booking and move"}
      </p>
      <div className="flex flex-wrap gap-3">
        {status.configured && (!status.connected || partial) && (
          <a href={googleConnectUrl} className={buttonClass("secondary")}>{partial ? "Reconnect Google Calendar" : "Connect Google Calendar"}</a>
        )}
        {(status.connected || status.hasRefreshToken) && (
          <Button variant="secondary" loading={busy} onClick={() => void disconnect()}>Disconnect Google Calendar</Button>
        )}
      </div>
      {error && <p role="alert" className="text-small text-nofit">{error}</p>}
    </Card>
  );
}
