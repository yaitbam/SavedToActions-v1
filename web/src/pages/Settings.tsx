import { Credits } from "../features/auth/Credits";
import { Account } from "../features/settings/Account";
import { useSession } from "../features/auth/SessionContext";
import { getGoals } from "../api/goals";
import { getSettings } from "../api/settings";
import { useAsync } from "../api/useAsync";
import { GoogleConnection } from "../features/settings/GoogleConnection";
import { SettingsForm } from "../features/settings/SettingsForm";
import { SettingsSection } from "../features/settings/SettingsSection";
import { ErrorState } from "../ui/ErrorState";
import { Skeleton } from "../ui/Skeleton";

export function Settings() {
  const { session } = useSession();
  const data = useAsync(async () => {
    const [settings, goals] = await Promise.all([getSettings(), getGoals()]);
    return { settings, goals };
  }, []);

  return (
    <div className="st">
      <h1 className="text-title">Settings</h1>
      <p className="st-intro">Your account, your calendar and the hours your time blocks can use.</p>
      <Account />
      <GoogleConnection />
      {data.error ? (
        <div className="border-t border-line py-8"><ErrorState title="Could not load settings" error={data.error} onRetry={() => void data.reload()} /></div>
      ) : data.data ? (
        <fieldset disabled={session?.kind === "demo"} className="m-0 min-w-0 border-0 p-0"><SettingsForm settings={data.data.settings} goals={data.data.goals} /></fieldset>
      ) : <div className="border-t border-line py-8"><Skeleton className="h-96" /></div>}
      <SettingsSection title="Credits" description="Credits reset every day at 00:00 GMT.">
        <Credits />
      </SettingsSection>
    </div>
  );
}
