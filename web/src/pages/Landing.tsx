import { Link } from "react-router-dom";
import { SocialPost } from "../features/landing/SocialPosts";
import { GOOGLE_REVIEW_PENDING } from "../links";
import { buttonClass } from "../ui/Button";
import { Logo } from "../ui/Logo";
import "../features/landing/landing.css";
import "../features/landing/landing-page.css";

// Only facts about the product. There are no customer logos or reviews to show yet, so none are made up.
const facts = [
  { title: "Google Calendar", body: "Blocks go on your own calendar" },
  { title: "Muse Spark Open", body: "An open weights model" },
  { title: "You approve", body: "Every write, every time" },
  { title: "Checked after", body: "Read back and rechecked" },
];

const chain = [
  { title: "See it", body: "A post worth acting on" },
  { title: "Save it", body: "One tap, and it feels handled" },
  { title: "The missing part", body: "Find the facts. Find the time.", gap: true },
  { title: "Do it", body: "Only if the part before it happened" },
];

const steps = [
  { n: "1", title: "Drop it and say when", body: "A screenshot and a line like “tonight, 30 min”. Add the post link if you want it later." },
  { n: "2", title: "Muse suggests a time", body: "A free slot that fits your note, your working hours and the deadline." },
  { n: "3", title: "Approve in one tap", body: "It lands on your calendar with a link back to the post." },
];

const features = [
  { title: "Say it in a few words", body: "One line, 160 characters. Muse reads only when and how long.", lead: true },
  { title: "Crop out the noise", body: "Cut the status bar and other posts. What you cut is never uploaded." },
  { title: "Facts with a source", body: "A deadline needs a quote from your post. Missing stays Missing." },
  { title: "Goals that are yours", body: "Six general goals to start. Add your own any time." },
  { title: "The post, one tap away", body: "Keep the link. It rides along in the calendar event." },
  { title: "Time that stays protected", body: "A meeting lands on it? Review and approve a new time." },
];

const goals = [
  { name: "Learn a skill", done: 3, saved: 5, dot: "learn" },
  { name: "Earn more", done: 2, saved: 6, dot: "earn" },
  { name: "Events and opportunities", done: 4, saved: 5, dot: "events" },
];

const never = [
  { lead: "No scraping.", body: "Only the screenshots, notes and links you give it. No DMs, no posting for you." },
  { lead: "No invented details.", body: "No deadline, effort or link is made up." },
  { lead: "No surprise writes.", body: "Nothing reaches your calendar without your approval." },
  { lead: "No after hours.", body: "Blocks stay inside your working hours." },
];

const faqs = [
  { q: "Do I need Google Calendar?", a: "To book time, yes. You can upload and review saves before you connect it." },
  { q: "Does Muse read my social accounts?", a: "No. It reads only the screenshot, note and link text you give it. We never open the post link." },
  { q: "What is the note for?", a: "To tell Muse when and for how long. It reads only those two things and ignores the rest." },
  { q: "Can Muse book without me?", a: "No. Muse only reads your calendar. A write happens after you approve, then it is read back to check." },
  { q: "Is it free?", a: "Yes. A free account gets 20 Muse reads a day. There are no paid plans." },
  { q: "Can anyone sign in?", a: `Yes, with a Google account.${GOOGLE_REVIEW_PENDING ? " Google may show an unverified app screen while our review is in progress. Choose Advanced, then continue." : ""}` },
  { q: "What is Muse Spark Open?", a: "An open weights model, called through Baseten. It reads and proposes. Code checks every fact and every write." },
];

export function Landing() {
  return <div className="landing">
    <a href="#main" className="landing-skip">Skip to content</a>
    <header className="landing-nav">
      <div className="landing-header landing-width">
        <Link to="/" aria-label="SavedToAction home"><Logo /></Link>
        <nav aria-label="Page"><a href="#how">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a><Link to="/login" className={buttonClass("secondary", "h-11")}>Open workspace ↗</Link></nav>
      </div>
    </header>
    <main id="main">
      <section className="lp-hero lp-w" aria-labelledby="hero-title">
        <div className="lp-hero-copy">
          <p className="lp-pill">For everything you saved and meant to do</p>
          <h1 id="hero-title">Saved is<br /><em>not done.</em></h1>
          <p className="lp-lede">Drop a screenshot and one line. Muse finds the time. You approve it.</p>
          <div className="lp-actions">
            <Link to="/login" className={buttonClass("primary")}>Make time for it <span>↗</span></Link>
            <a href="#how">See how it works ↓</a>
          </div>
          <ul className="lp-proof" aria-label="At a glance">
            <li>Free to try</li><li>Works with Google Calendar</li><li>Nothing booked until you approve</li>
          </ul>
        </div>
        <figure className="lp-art">
          <SocialPost index={0} lit />
          <div className="plan-card" role="group" aria-label="The time Muse suggests for the post">
            <header><b>Muse suggests</b><span className="note-chip"><i aria-hidden="true" />From your note: Tonight · 30 min</span></header>
            <p className="plan-time">Today 17:00 to 17:30</p>
            <p className="plan-match">Matches your note: “tonight”</p>
            <div className="plan-btn" aria-hidden="true">Add 30 min to calendar</div>
            <p className="plan-fine">You approve it. Then it is read back to check.</p>
          </div>
        </figure>
      </section>

      <section className="lp-facts lp-w" aria-label="What it is built on">
        <ul>
          {facts.map((f) => <li key={f.title}><b>{f.title}</b><span>{f.body}</span></li>)}
        </ul>
      </section>

      <section id="pain" className="lp-dark" aria-labelledby="pain-title">
        <div className="lp-w">
          <header className="lp-head">
            <p className="eyebrow">The real problem</p>
            <h2 id="pain-title">Saving takes one tap.<br /><em>Acting takes time nobody set aside.</em></h2>
          </header>
          <ol className="chain" aria-label="Where a saved post gets stuck">
            {chain.map((c) => <li key={c.title} className={c.gap ? "chain-gap" : undefined}><b>{c.title}</b><span>{c.body}</span></li>)}
          </ol>
          <p className="lp-note">Your calendar never hears about a saved post, so it loses to everything that has an invitation.</p>
        </div>
      </section>

      <section id="how" className="lp-how lp-w" aria-labelledby="how-title">
        <header className="lp-head">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">From screenshot to calendar<br /><em>in three steps.</em></h2>
        </header>
        <div className="how-grid">
          <ol className="how-steps">
            {steps.map((s) => <li key={s.n}><span className="how-n" aria-hidden="true">{s.n}</span><div><h3>{s.title}</h3><p>{s.body}</p></div></li>)}
          </ol>
          <div className="flow" aria-label="A note becomes a calendar block">
            <div className="flow-card">
              <span className="flow-label">Your note</span>
              <p className="flow-note">tonight, 30 min</p>
              <span className="flow-chips"><i>Tonight</i><i>30 min</i><i className="is-link">Post link</i></span>
            </div>
            <span className="flow-arrow" aria-hidden="true">↓</span>
            <div className="flow-card flow-event">
              <span className="flow-label">On your calendar</span>
              <b>Apply to the fellowship</b>
              <p>Today 17:00 to 17:30</p>
              <span className="flow-link">Original post ↗</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="lp-value" aria-labelledby="value-title">
        <div className="lp-w">
          <header className="lp-head">
            <p className="eyebrow">What you get</p>
            <h2 id="value-title">A plan you can check,<br /><em>not a promise.</em></h2>
          </header>
          <div className="feature-grid">
            {features.map((f) => <article key={f.title} className={f.lead ? "is-lead" : undefined}><h3>{f.title}</h3><p>{f.body}</p></article>)}
          </div>
        </div>
      </section>

      <section id="impact" className="lp-impact lp-w" aria-labelledby="impact-title">
        <div className="impact-grid">
          <header>
            <p className="eyebrow">The impact</p>
            <h2 id="impact-title">See whether saving<br /><em>became doing.</em></h2>
            <p className="lp-copy">For each goal, the app counts what really happened, from your own records only.</p>
          </header>
          <aside className="goal-card" aria-label="Progress by goal">
            <header><b>Saves done, by goal</b></header>
            <ul>
              {goals.map((g) => (
                <li key={g.name}>
                  <div><span className="goal-name"><i className={`goal-dot dot-${g.dot}`} aria-hidden="true" />{g.name}</span><span className="goal-num"><b>{g.done}</b> of {g.saved} done</span></div>
                  <div className="goal-bar" aria-hidden="true"><div className={`dot-${g.dot}`} style={{ width: `${(g.done / g.saved) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="lp-dark lp-never" aria-labelledby="never-title">
        <div className="lp-w never-grid">
          <header>
            <p className="eyebrow">Boundaries</p>
            <h2 id="never-title">What it will<br /><em>never do.</em></h2>
          </header>
          <ul>
            {never.map((n) => <li key={n.lead}><b>{n.lead}</b> {n.body}</li>)}
          </ul>
        </div>
      </section>

      <section id="faq" className="lp-faq lp-w" aria-labelledby="faq-title">
        <header className="lp-head">
          <p className="eyebrow">Questions</p>
          <h2 id="faq-title">Before you try it.</h2>
        </header>
        <div className="faq-list">
          {faqs.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
        </div>
      </section>

      <section className="landing-close">
        <h2>Turn what you saved<br />into <em>time you protected.</em></h2>
        <p className="section-copy">Free to try. Nothing is booked until you say yes.</p>
        <Link to="/login" className={buttonClass("primary")}>Make time for it ↗</Link>
      </section>
    </main>
    <footer className="landing-footer landing-width"><Logo /><span>Make room for what matters.</span><Link to="/privacy">Privacy</Link><span>© 2026 SavedToAction</span></footer>
  </div>;
}
