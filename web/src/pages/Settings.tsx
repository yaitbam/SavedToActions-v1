import { getGoals } from "../api/goals";
import { getSettings } from "../api/settings";
import { useAsync } from "../api/useAsync";
import { GoogleConnection } from "../features/settings/GoogleConnection";
import { SettingsForm } from "../features/settings/SettingsForm";
import { ErrorState } from "../ui/ErrorState";
import { Skeleton } from "../ui/Skeleton";

export function Settings() {
  const data = useAsync(async () => {
    const [settings, goals] = await Promise.all([getSettings(), getGoals()]);
    return { settings, goals };
  }, []);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-title">Settings</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {data.error ? (
          <ErrorState title="Could not load settings" error={data.error} onRetry={() => void data.reload()} />
        ) : data.data ? (
          <SettingsForm settings={data.data.settings} goals={data.data.goals} />
        ) : <Skeleton className="h-96" />}
        <GoogleConnection />
      </div>
    </div>
  );
}
