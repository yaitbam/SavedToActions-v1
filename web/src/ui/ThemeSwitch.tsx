import { useEffect, useState } from "react";
export function ThemeSwitch() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === "dark");
    window.addEventListener("sta-theme-change", sync);
    return () => window.removeEventListener("sta-theme-change", sync);
  }, []);
  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("sta-theme", next ? "dark" : "light"); } catch { /* Theme still works when storage is unavailable. */ }
    setDark(next);
    window.dispatchEvent(new Event("sta-theme-change"));
  }
  return <button type="button" onClick={toggle} aria-label={`Use ${dark ? "light" : "dark"} theme`} className="rounded-full border border-line bg-surface px-3 py-2 text-small text-muted">{dark ? "Light ◐" : "Dark ◑"}</button>;
}
