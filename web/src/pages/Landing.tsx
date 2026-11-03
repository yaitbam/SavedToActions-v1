import { Link } from "react-router-dom";
import { buttonClass } from "../ui/Button";
import { Logo } from "../ui/Logo";

export function Landing() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-4">
      <Logo />
      <h1 className="text-title">Don't just save it. Book it.</h1>
      <Link to="/app" className={buttonClass("primary")}>
        Try it
      </Link>
    </div>
  );
}
