import type { ReactElement } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useNewSave } from "../features/newSave/NewSaveContext";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Logo } from "../ui/Logo";
import { HomeIcon, ProgressIcon, SavesIcon, SettingsIcon } from "./icons";

const items: Array<{ to: string; label: string; icon: ReactElement; end?: boolean }> = [
  { to: "/app", label: "Home", icon: <HomeIcon />, end: true },
  { to: "/app/saves", label: "Saves", icon: <SavesIcon /> },
  { to: "/app/progress", label: "Progress", icon: <ProgressIcon /> },
  { to: "/app/settings", label: "Settings", icon: <SettingsIcon /> },
];

export function AppShell() {
  const { open } = useNewSave();
  const onNewSave = () => open();
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-8 p-6 md:flex">
        <Logo />
        <Button onClick={onNewSave}>New save</Button>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  "flex h-12 items-center gap-3 rounded-full px-4 font-semibold transition-colors duration-150",
                  isActive ? "bg-accent text-ink" : "text-ink hover:bg-surface",
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <header className="flex items-center justify-between px-4 py-3 md:hidden">
        <Logo />
        <Button className="h-10 px-4" onClick={onNewSave}>
          New save
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 md:ml-64 md:max-w-none md:px-10 md:py-10">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-line bg-surface md:hidden"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                "m-1 flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-small font-semibold",
                isActive ? "bg-accent text-ink" : "text-muted",
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
