import { useState } from "react";
import { logout } from "../../api/session";
import { clearSession } from "../../api/client";
import { errorText } from "../../api/errors";
import { useAlert } from "../../ui/AlertProvider";

export function useSignOut() {
  const [busy, setBusy] = useState(false);
  const alert = useAlert();
  async function signOut() {
    setBusy(true);
    try { await logout(); clearSession(); window.location.replace("/login"); }
    catch (cause) { alert.error(errorText(cause, "Could not sign out. Try again")); setBusy(false); }
  }
  return { signOut, signingOut: busy };
}
