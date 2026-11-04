import { Link } from "react-router-dom";
import { buttonClass } from "../ui/Button";
import { Logo } from "../ui/Logo";
import { Chip } from "../ui/Chip";
import { SavedDesk } from "../features/landing/SavedDesk";
import { LandingSteps } from "../features/landing/LandingSteps";
import "../features/landing/landing.css";

export function Landing() {
  return (
    <div className="landing">
      <a href="#main" className="landing-skip">Skip to content</a>
      <header className="landing-header landing-width">
        <Logo />
        <a href="#how-it-works" className="landing-nav">How it works <span aria-hidden="true">↘</span></a>
      </header>
      <main id="main">
        <section className="landing-hero landing-width" aria-labelledby="landing-title">
          <div className="landing-intro">
            <p className="landing-eyebrow">For everything you saved for later</p>
            <h1 id="landing-title">Don't just<br />save it.<br /><mark>Book it.</mark></h1>
            <p className="landing-subline">
              Drop a screenshot. SavedToAction reads it, finds the time, puts it on your calendar,
              and moves it when your week gets in the way.
            </p>
            <div className="landing-cta">
              <Link to="/app" className={buttonClass("primary", "min-w-36")}>
                Try it <span aria-hidden="true">↗</span>
              </Link>
              <Chip>Built on Muse Spark Open</Chip>
            </div>
            <p className="landing-approval">You review it before anything is booked</p>
          </div>
          <SavedDesk />
        </section>
        <section className="landing-pain" aria-labelledby="pain-title">
          <div className="landing-width landing-pain-inner">
            <p className="landing-eyebrow">Sound familiar?</p>
            <h2 id="pain-title">Your Saved folder is a to do list you never scheduled.</h2>
            <p>A prompt to try. A skill to learn. An opportunity to take.<br className="hidden md:block" />
              {" "}Give that intention a place in your week.</p>
          </div>
        </section>
        <LandingSteps />
        <section className="landing-trust landing-width" aria-labelledby="trust-title">
          <p className="landing-eyebrow">Your calendar. Your call.</p>
          <h2 id="trust-title">The AI proposes.<br />Code checks every write.<br /><span>You approve.</span></h2>
          <p>Only your confirmed effort is scheduled. Calendar changes need your approval and are checked after every write.</p>
        </section>
      </main>
      <footer className="landing-footer landing-width">
        <Logo />
        <p>No scraping. Bring your own screenshots.<br />Illustrative posts and accounts are fictional.</p>
      </footer>
    </div>
  );
}
