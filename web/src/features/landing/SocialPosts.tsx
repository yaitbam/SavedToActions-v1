import type { ReactNode } from "react";
import { BookmarkIcon, CommentIcon, HeartIcon, InstagramIcon, LinkedInIcon, PlayIcon, RepostIcon, SendIcon, XIcon } from "../../ui/PlatformIcons";

// Every account, organization and number on these cards is invented for the demo.
export const posts = [
  { platform: "instagram", tab: "Instagram Reel", body: "Bring a small idea to life. Submit your working prototype by Nov 14, 18:00 UTC.", quote: "Nov 14, 18:00 UTC", task: "Build your prototype" },
  { platform: "x", tab: "X Bookmark", body: "Try this prompt: Turn these meeting notes into three concrete next steps. Keep each step under 20 words.", quote: "under 20 words", task: "Try the meeting prompt" },
  { platform: "linkedin", tab: "LinkedIn Post", body: "A six week cohort on building a design system from scratch. Registration closes Nov 20, 17:00 UTC.", quote: "Nov 20, 17:00 UTC", task: "Register for the cohort" },
] as const;

interface PostProps {
  lit?: boolean;
  scanning?: boolean;
}

function Caption({ index, lit, className, lead }: { index: number; lit: boolean; className: string; lead?: ReactNode }) {
  const post = posts[index];
  const [before, after] = post.body.split(post.quote);
  return <p className={className}>{lead}{before}<mark className={lit ? "quote-lit" : ""}>{post.quote}</mark>{after}</p>;
}

const Beam = ({ on }: { on: boolean }) => (on ? <i className="scan-beam" aria-hidden="true" /> : null);

function InstagramPost({ lit = false, scanning = false }: PostProps) {
  return <article className="sp sp-ig" aria-label="Instagram Reel from build.weekend">
    <header className="sp-head">
      <span className="sp-ring"><span className="sp-avatar sp-av-ig">bw</span></span>
      <div><strong>build.weekend</strong></div>
      <span className="sp-pill sp-pill-ig"><InstagramIcon width={13} height={13} /> Instagram Reel</span>
    </header>
    <div className="sp-media sp-media-ig">
      <span className="sp-glass"><PlayIcon width={12} height={12} /> Reel</span>
      <p className="sp-reel-title">A weekend.<br />One working idea.</p>
      <span className="sp-saved"><span className="sp-saved-dot" aria-hidden="true" />Saved<BookmarkIcon filled width={14} height={14} /></span>
      <Beam on={scanning} />
    </div>
    <div className="sp-actions" aria-hidden="true"><HeartIcon /><CommentIcon /><SendIcon /><BookmarkIcon filled className="sp-bm" /></div>
    <Caption index={0} lit={lit} className="sp-caption" lead={<><strong>build.weekend</strong>{" "}</>} />
  </article>;
}

function XPost({ lit = false, scanning = false }: PostProps) {
  return <article className="sp sp-x" aria-label="Illustrative X post from prompt.notes, a fictional account">
    <header className="sp-head">
      <span className="sp-avatar sp-av-x">pn</span>
      <div><strong>Prompt Notes</strong><small>@prompt.notes · Fictional account</small></div>
      <XIcon className="sp-logo" width={18} height={18} />
    </header>
    <Caption index={1} lit={lit} className="sp-tweet" />
    <p className="sp-thread">Thread 1/3</p>
    <div className="sp-embed" role="img" aria-label="Diagram: meeting notes become three next steps, each under 20 words">
      <span className="sp-embed-bar"><i /><i /><i /><b>notes-to-steps.md</b></span>
      <div className="sp-flow"><span>Notes</span><em aria-hidden="true">→</em><span>3 steps</span><em aria-hidden="true">→</em><span className="sp-flow-end">≤ 20 words</span></div>
      <Beam on={scanning} />
    </div>
    <footer className="sp-metrics"><span><b>248</b> Replies</span><span><b>1.4K</b> Bookmarks</span><BookmarkIcon filled className="sp-bm sp-bm-x" width={18} height={18} /></footer>
  </article>;
}

function LinkedInPost({ lit = false, scanning = false }: PostProps) {
  return <article className="sp sp-li" aria-label="Illustrative LinkedIn event post from Design Systems Cohort, a fictional organization">
    <header className="sp-head">
      <span className="sp-avatar sp-av-li">DS</span>
      <div><strong>Design Systems Cohort</strong><small>Fictional organization · Event</small></div>
      <LinkedInIcon className="sp-logo" width={19} height={19} />
    </header>
    <Caption index={2} lit={lit} className="sp-body" />
    <div className="sp-media sp-media-li">
      <span className="sp-event">Event</span>
      <Beam on={scanning} />
    </div>
    <footer className="sp-li-actions" aria-hidden="true"><span><HeartIcon width={16} height={16} /> Like</span><span><CommentIcon width={16} height={16} /> Comment</span><span><RepostIcon width={16} height={16} /> Repost</span><span className="sp-li-saved"><BookmarkIcon filled width={16} height={16} /> Saved</span></footer>
  </article>;
}

export function SocialPost({ index, lit = false, scanning = false }: PostProps & { index: number }) {
  if (index === 1) return <XPost lit={lit} scanning={scanning} />;
  if (index === 2) return <LinkedInPost lit={lit} scanning={scanning} />;
  return <InstagramPost lit={lit} scanning={scanning} />;
}
