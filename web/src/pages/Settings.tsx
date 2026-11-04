import { Credits } from "../features/auth/Credits";
import { Account } from "../features/settings/Account";
import { useSession } from "../features/auth/SessionContext";
import { Card } from "../ui/Card";
import { getGoals } from "../api/goals";
import { getSettings } from "../api/settings";
import { useAsync } from "../api/useAsync";
import { GoogleConnection } from "../features/settings/GoogleConnection";
import { SettingsForm } from "../features/settings/SettingsForm";
import { ErrorState } from "../ui/ErrorState";
import { Skeleton } from "../ui/Skeleton";

export function Settings() {
  const { session } = useSession();
  const data = useAsync(async () => {
    const [settings, goals] = await Promise.all([getSettings(), getGoals()]);
    return { settings, goals };
  }, []);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-title">Settings</h1>
      <Account />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {data.error ? (
          <ErrorState title="Could not load settings" error={data.error} onRetry={() => void data.reload()} />
        ) : data.data ? (
          <fieldset disabled={session?.kind === "demo"}><SettingsForm settings={data.data.settings} goals={data.data.goals} /></fieldset>
        ) : <Skeleton className="h-96" />}
        <div className="space-y-6"><GoogleConnection />
          <Card className="space-y-2"><h2 className="text-base">Credits</h2><Credits /></Card>
        </div>
      </div>
    </div>
  );
}
