import { FixtureCard, illustrativePosts } from "./FixtureCard";

const steps = [
  { title: "Drop a screenshot.", description: "Bring a post you meant to act on. Muse Spark Open reads the image and finds the action worth taking." },
  { title: "Confirm how long it takes.", description: "Review what came from the post and give it your own time estimate. You decide what gets scheduled." },
  { title: "Give it calendar time.", description: "Approve a slot that fits your week. If plans change, review a new time before anything moves." },
];

export function LandingSteps() {
  return (
    <section id="how-it-works" className="landing-steps landing-width" aria-labelledby="steps-title">
      <div className="landing-steps-heading">
        <p className="landing-eyebrow">From intention to a plan</p>
        <h2 id="steps-title">Make later happen.</h2>
      </div>
      <ol className="landing-step-list">
        {steps.map((step, index) => (
          <li key={step.title}>
            <div className="landing-step-image"><FixtureCard post={illustrativePosts[index]} /></div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
      <p className="landing-demo">Imported demo data · Illustrative posts and accounts are fictional</p>
    </section>
  );
}
