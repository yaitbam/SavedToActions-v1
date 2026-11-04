import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../../ui/Logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-8 md:px-10">
    <header><Link to="/" aria-label="SavedToAction home"><Logo /></Link></header>
    <main className="mx-auto my-auto w-full max-w-xl py-12">{children}</main>
    <footer className="flex justify-between gap-4 text-small text-muted"><span>© 2026 SavedToAction</span><Link to="/privacy" className="underline">Privacy</Link></footer>
  </div>;
}
