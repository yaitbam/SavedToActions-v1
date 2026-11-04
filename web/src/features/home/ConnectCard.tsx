import { googleConnectUrl } from "../../api/auth";
import { buttonClass } from "../../ui/Button";
import { Card } from "../../ui/Card";

// First run: shown instead of the sections that need a calendar.
export function ConnectCard() {
  return (
    <Card note className="max-w-xl space-y-4">
      <h2 className="text-base">Connect Google Calendar</h2>
      <p className="text-muted">Nothing is written to your calendar until you approve a time</p>
      <a href={googleConnectUrl} className={buttonClass("primary")}>
        Connect Google Calendar
      </a>
    </Card>
  );
}
