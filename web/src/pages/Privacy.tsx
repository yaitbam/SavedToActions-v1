import { useModelLabel } from "../api/model";
import { AuthLayout } from "../features/auth/AuthLayout";
export function Privacy() {
  const label = useModelLabel();
  return <AuthLayout><article className="space-y-6"><h1 className="text-title">Your privacy</h1>
    <p>SavedToAction uses your Google name and verified email for your account. Your workspace holds screenshots, notes, actions and calendar blocks created through the app.</p>
    <p>{label} receives the screenshot and context needed to read a save or plan an action. Google Calendar is used to check availability and to write changes you approve.</p>
    <p>We do not scrape saved posts or send messages on your behalf. Google credentials stay on the server.</p>
    <p>Account deletion is not connected yet. This page will be updated when the account services are available.</p>
  </article></AuthLayout>;
}
