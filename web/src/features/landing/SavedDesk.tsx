import { Chip } from "../../ui/Chip";
import { FixtureCard, illustrativePosts } from "./FixtureCard";

export function SavedDesk() {
  return (
    <div className="landing-desk" aria-label="Illustration of saved posts becoming protected time">
      <p className="landing-eyebrow">From “I'll come back to this”</p>
      <div className="landing-note-row">
        {illustrativePosts.map(post => <FixtureCard key={post.file} post={post} />)}
      </div>
      <p className="landing-desk-connector">to a place in your week <span aria-hidden="true">↴</span></p>
      <div className="landing-week">
        <div className="landing-week-heading">
          <span className="font-display text-xl font-extrabold">Time, protected.</span>
          <Chip tone="fits">You approve</Chip>
        </div>
        <div className="landing-week-grid" aria-hidden="true">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map(day => <span key={day}>{day}</span>)}
          <div className="landing-week-block"><strong>Your saved idea</strong><span>Protected time</span></div>
        </div>
        <p className="landing-week-caption">Illustrative week · After your approval</p>
      </div>
      <p className="landing-demo">Imported demo data · Fictional illustrative posts</p>
    </div>
  );
}
