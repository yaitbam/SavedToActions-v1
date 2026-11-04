import { useState } from "react";
import { errorText } from "../../api/errors";
import { confirmTimezone, getTimezones } from "../../api/settings";
import { useAsync } from "../../api/useAsync";
import { useAlert } from "../../ui/AlertProvider";
import { Button } from "../../ui/Button";
import { TimezonePicker } from "../settings/TimezonePicker";
import "./goals-setup.css";

interface Props {
  // The zone the workspace starts with.
  current: string | null;
  onDone: () => void;
}

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

// Shown on Overview once the calendar is connected, until the user confirms a timezone.
// Every time block, working hour and deadline uses it, so it is asked about before anything is scheduled.
export function TimezoneSetup({ current, onDone }: Props) {
  const [tz, setTz] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const zones = useAsync(async () => (await getTimezones()).zones, []);
  const alert = useAlert();
  const detected = browserZone();
  // Only offer the browser's guess when the server knows the zone and it differs from the choice.
  const suggestion = detected && detected !== tz && zones.data?.some((zone) => zone.id === detected) ? detected : null;

  async function confirm() {
    if (!tz) return;
    setBusy(true);
    try {
      await confirmTimezone(tz);
      onDone();
    } catch (cause) {
      alert.error(errorText(cause, "Could not save your timezone. Try again"), { title: "Timezone not saved" });
      setBusy(false);
    }
  }

  return (
    <section className="gs" aria-labelledby="tz-title">
      <div className="gs-head">
        <p className="gs-step">Quick setup</p>
        <h2 id="tz-title">Confirm your timezone</h2>
        <p>
          Your working hours, deadlines and every time block use this timezone. We started you in US Eastern time,
          so choose yours to make sure nothing lands at the wrong hour. You can change it any time in Settings.
        </p>
      </div>
      <div className="gs-tz">
        <span className="st-label" aria-hidden="true">Timezone</span>
        <TimezonePicker value={tz} onChange={setTz} describedBy="tz-setup-hint" />
        <p id="tz-setup-hint" className="gs-hint">Choose from the list or type a city to search</p>
        {suggestion && (
          <p className="gs-suggest">
            Your browser reports <b>{suggestion}</b>.{" "}
            <button type="button" className="gs-link" onClick={() => setTz(suggestion)} disabled={busy}>Use it</button>
          </p>
        )}
      </div>
      <div className="gs-foot">
        <p>Used for scheduling only. Nothing is written to your calendar until you approve a time</p>
        <div className="gs-actions">
          <Button type="button" onClick={() => void confirm()} loading={busy} disabled={!tz || busy}>Confirm timezone</Button>
        </div>
      </div>
    </section>
  );
}
