import { ProductShot } from "./ProductShot";

const steps = [
  { title: "Review your save.", description: "Drop a screenshot, review the action and confirm how long it takes you.", image: "review", alt: "Review with effort chips and an Add to calendar button" },
  { title: "Book the time.", description: "Approve a slot that fits your week. The receipt confirms the calendar matched your booking.", image: "receipt", alt: "Booked receipt confirming the calendar matched start, end and timezone" },
  { title: "Keep your plan moving.", description: "When a meeting overlaps your block, review another time and approve the move.", image: "conflict", alt: "Conflict card with a Move to Today 09:30 button" },
] as const;

export function LandingSteps() {
  return (
    <section id="how-it-works" className="landing-steps landing-width" aria-labelledby="steps-title">
      <div className="landing-steps-heading">
        <p className="landing-eyebrow">From intention to a plan</p>
        <h2 id="steps-title">Make later happen.</h2>
      </div>
      <ol className="landing-step-list">
        {steps.map((step) => (
          <li key={step.title}>
            <div className="landing-step-image"><ProductShot name={step.image} alt={step.alt} /></div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
      <p className="landing-demo">Imported demo data · Illustrative posts and accounts are fictional</p>
    </section>
  );
}
