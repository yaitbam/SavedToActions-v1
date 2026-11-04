import { Link } from "react-router-dom";
import { SocialPost } from "../features/landing/SocialPosts";
import { buttonClass } from "../ui/Button";
import { Logo } from "../ui/Logo";
import { ThemeSwitch } from "../ui/ThemeSwitch";
import "../features/landing/landing.css";
import "../features/landing/landing-page.css";

const pains = [
  { title: "Saved feels like progress", body: "One tap and your brain files it as handled. The post is still unread, the task is still undone." },
  { title: "The facts sit inside a picture", body: "The deadline, the prompt and the link are trapped in a screenshot. To act, you reopen it, reread it and work out what it asks for." },
  { title: "Your calendar never hears about it", body: "Meetings have invitations. A saved post has no owner, no slot and no date, so it loses to everything that does." },
];

const steps = [
  { n: "1", title: "Drop a screenshot", body: "Add a saved post, with a note if you like. Muse Spark Open reads it. Every field shows where it came from, and anything the post does not state stays Missing." },
  { n: "2", title: "Confirm the effort", body: "The model suggests minutes. Only the minutes you confirm are ever scheduled." },
  { n: "3", title: "Approve a time", body: "The block is written to your Google Calendar after you approve it, read back to check it matches, and rechecked when your week changes." },
];

const values = [
  { title: "Facts with a source", body: "A deadline exists only when its quote is found in your note or in the text read from the image. No quote, no deadline. We never invent dates, links, prompts or urgency.", wide: true },
  { title: "Your effort, not a guess", body: "The model suggests. You decide. Only the minutes you confirm are scheduled." },
  { title: "Time that stays protected", body: "One block per action, inside your working hours. When a meeting lands on it, you review the conflict and approve a new time. The old block is marked superseded, so the two are never counted together." },
  { title: "Writes you can verify", body: "A fresh availability check before every write. Afterward the app reads the event back and flags any drift in start, end or timezone.", wide: true },
];

const metrics = [
  { name: "Imported saves", note: "Posts you brought in for this goal." },
  { name: "Planned", note: "Saves that have an approved block." },
  { name: "Marked done", note: "Saves you marked done. Self reported." },
  { name: "Passed without completion", note: "Deadline passed and nothing was done. Skipped saves are excluded." },
  { name: "Action rate", note: "Distinct saves with a done action, divided by distinct imported saves.", lead: true },
  { name: "Time scheduled", note: "Minutes in active blocks. Superseded blocks never count." },
];

const never = [
  { lead: "No scraping.", body: "It reads only the screenshots, notes and pasted text you give it. No DMs, no auto comments, no posting for you." },
  { lead: "No invented details.", body: "Missing stays Missing. No deadline, effort, link or urgency is made up." },
  { lead: "No surprise writes.", body: "Nothing reaches your calendar without your approval." },
  { lead: "No after hours.", body: "Blocks are never placed outside your working hours." },
  { lead: "No advice.", body: "No financial advice, and it steers clear of medical and political content." },
];

export function Landing() {
  return <div className="landing">
    <a href="#main" className="landing-skip">Skip to content</a>
    <header className="landing-nav">
      <div className="landing-header landing-width">
        <Link to="/" aria-label="SavedToAction home"><Logo /></Link>
        <nav aria-label="Page"><a href="#pain">The problem</a><a href="#how">How it works</a><a href="#value">Value</a><a href="#impact">Impact</a><ThemeSwitch /><Link to="/login" className={buttonClass("secondary", "h-11")}>Open workspace ↗</Link></nav>
      </div>
    </header>
    <main id="main">
      <section className="lp-hero lp-w" aria-labelledby="hero-title">
        <div className="lp-hero-copy">
          <p className="lp-pill">For everything you saved and meant to do</p>
          <h1 id="hero-title">Saved is<br /><em>not done.</em></h1>
          <p className="lp-lede">SavedToAction turns a screenshot of a post you saved into protected time on your Google Calendar. You confirm the effort. You approve the time. Nothing is invented.</p>
          <div className="lp-actions">
            <Link to="/login" className={buttonClass("primary")}>Make time for it <span>↗</span></Link>
            <a href="#pain">Why saving fails ↓</a>
          </div>
        </div>
        <figure className="lp-art">
          <SocialPost index={0} lit />
          <div className="plan-card" role="group" aria-label="The plan made from the post">
            <header><b>Plan</b><span className="state"><i aria-hidden="true" />Fits</span></header>
            <dl>
              <div><dt>Deadline</dt><dd>Nov 14, 18:00 UTC<small>Quote found in the post</small></dd></div>
              <div><dt>Effort</dt><dd>45 min<small>You confirmed</small></dd></div>
              <div><dt>Block</dt><dd>Thu Nov 12, 11:00 to 11:45<small>Waiting for your approval</small></dd></div>
            </dl>
          </div>
        </figure>
      </section>

      <section id="pain" className="lp-dark" aria-labelledby="pain-title">
        <div className="lp-w">
          <header className="lp-head">
            <p className="eyebrow">The real problem</p>
            <h2 id="pain-title">Saving takes one tap.<br /><em>Acting takes time nobody set aside.</em></h2>
            <p className="lp-copy">You save a post because you mean to act on it: a hackathon deadline, a prompt to try, a course, a freelance tip. Then the week fills up and the deadline passes. Nothing is wrong with you. The save button just stops halfway.</p>
          </header>
          <ol className="chain" aria-label="Where a saved post gets stuck">
            <li><b>See it</b><span>A post worth acting on</span></li>
            <li><b>Save it</b><span>One tap, and it feels handled</span></li>
            <li className="chain-gap"><b>The missing part</b><span>Find the facts. Decide the effort. Find the time.</span></li>
            <li><b>Do it</b><span>Only if the part before it happened</span></li>
          </ol>
          <div className="pain-grid">
            {pains.map((p) => <article key={p.title}><h3>{p.title}</h3><p>{p.body}</p></article>)}
          </div>
        </div>
      </section>

      <section id="how" className="lp-how lp-w" aria-labelledby="how-title">
        <header className="lp-head">
          <p className="eyebrow">What SavedToAction is</p>
          <h2 id="how-title">The missing part,<br /><em>done with you.</em></h2>
          <p className="lp-copy">It fills the gap between Saved and done: it reads the post, asks you how long it will take, and puts that time on your calendar once you say yes.</p>
        </header>
        <div className="how-grid">
          <ol className="how-steps">
            {steps.map((s) => <li key={s.n}><span className="how-n" aria-hidden="true">{s.n}</span><div><h3>{s.title}</h3><p>{s.body}</p></div></li>)}
          </ol>
          <aside className="sheet" aria-label="Fields read from one post">
            <header><b>Read from the post</b><span>Where each field came from</span></header>
            <dl>
              <div><dt>Title</dt><dd>Build your prototype<small>From the post text</small></dd></div>
              <div><dt>Deadline</dt><dd>Nov 14, 18:00 UTC<small>Supporting quote found</small></dd></div>
              <div><dt>Link</dt><dd><span className="missing"><i aria-hidden="true" />Missing</span><small>The post does not state one</small></dd></div>
              <div><dt>Effort</dt><dd>45 min<small>Suggested by the model, you confirm</small></dd></div>
            </dl>
          </aside>
        </div>
      </section>

      <section id="value" className="lp-value" aria-labelledby="value-title">
        <div className="lp-w">
          <header className="lp-head">
            <p className="eyebrow">What you gain</p>
            <h2 id="value-title">A plan you can check,<br /><em>not a promise.</em></h2>
            <p className="lp-copy">The model reads and proposes. Code validates every fact and every write. You stay in charge of the effort and the approval.</p>
          </header>
          <div className="value-grid">
            {values.map((v) => <article key={v.title} className={v.wide ? "v-wide" : "v-narrow"}><h3>{v.title}</h3><p>{v.body}</p></article>)}
          </div>
          <p className="lp-note">Built on Muse Spark Open, an open weights model, through Baseten. The model only uses read only tools. It never writes to your calendar.</p>
        </div>
      </section>

      <section id="impact" className="lp-impact lp-w" aria-labelledby="impact-title">
        <header className="lp-head">
          <p className="eyebrow">The impact</p>
          <h2 id="impact-title">Know whether saving<br /><em>turned into doing.</em></h2>
          <p className="lp-copy">For each goal, SavedToAction counts what actually happened, from your own records only. No made up scores.</p>
        </header>
        <div className="metric-grid">
          {metrics.map((m) => <article key={m.name} className={m.lead ? "metric lead" : "metric"}><h3>{m.name}</h3><p>{m.note}</p></article>)}
        </div>
      </section>

      <section className="lp-dark lp-never" aria-labelledby="never-title">
        <div className="lp-w never-grid">
          <header>
            <p className="eyebrow">Boundaries</p>
            <h2 id="never-title">What it will<br /><em>never do.</em></h2>
            <p className="lp-copy">Honest limits: goal assignment is the weakest part of extraction, so you can always pick the goal yourself. Google sign in is in Testing mode, so accounts are added as test users.</p>
          </header>
          <ul>
            {never.map((n) => <li key={n.lead}><b>{n.lead}</b> {n.body}</li>)}
          </ul>
        </div>
      </section>

      <section className="landing-close">
        <h2>Turn what you saved<br />into <em>time you protected.</em></h2>
        <p className="section-copy">Your minutes. Your approval. Every write checked.</p>
        <Link to="/login" className={buttonClass("primary")}>Make time for it ↗</Link>
      </section>
    </main>
    <footer className="landing-footer landing-width"><Logo /><span>Make room for what matters.</span><Link to="/privacy">Privacy</Link><span>© 2026 SavedToAction</span></footer>
  </div>;
}
