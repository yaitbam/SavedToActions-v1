import { useSession } from "../auth/SessionContext";
import { googleConnectUrl } from "../../api/auth";
import { GoogleIcon } from "../../ui/PlatformIcons";
import "../auth/login.css";
import "./home.css";

// First run: shown above the drop zone until the calendar is connected. Saves can be added meanwhile.
export function ConnectCard() {
  const { session } = useSession();
  if (session?.kind === "demo") return null;
  return (
    <section className="hm-setup" aria-labelledby="setup-title">
      <div>
        <h2 id="setup-title">Connect your Google Calendar</h2>
        <p>SavedToAction looks at when you are free and places a block only after you approve a time. Nothing is written until you say yes.</p>
        <a href={googleConnectUrl} className="google-btn"><GoogleIcon />Connect Google Calendar</a>
        <ul className="hm-trust">
          <li>You approve every booking and every move</li>
          <li>Your existing events are never edited</li>
          <li>You can disconnect any time in Settings</li>
        </ul>
      </div>
      <ol className="hm-steps" aria-label="Setup progress">
        <li className="is-done">
          <div><b>Signed in</b><span>{session?.email ?? "With Google"}</span></div>
          <span className="hm-state"><i aria-hidden="true" />Done</span>
        </li>
        <li className="is-now">
          <div><b>Connect your calendar</b><span>Needed to find free time</span></div>
          <span className="hm-state"><i aria-hidden="true" />Next</span>
        </li>
        <li>
          <div><b>Choose your goals</b><span>Right after you connect</span></div>
          <span className="hm-state"><i aria-hidden="true" />Soon</span>
        </li>
        <li>
          <div><b>Drop a screenshot</b><span>You can do this now, below</span></div>
          <span className="hm-state"><i aria-hidden="true" />Anytime</span>
        </li>
      </ol>
    </section>
  );
}
