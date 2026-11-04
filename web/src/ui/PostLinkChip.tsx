import type { PostLink } from "../api/types";
import { cx } from "./cx";

const NAMES: Record<string, string> = {
  x: "X", linkedin: "LinkedIn", instagram: "Instagram", tiktok: "TikTok", threads: "Threads",
  facebook: "Facebook", youtube: "YouTube", reddit: "Reddit",
};

export const platformName = (link: PostLink) => NAMES[link.platform] ?? link.host;

// Opens the original post in a new tab. The app never loads it, so there is no preview and nothing is fetched.
export function PostLinkChip({ link, className }: { link: PostLink; className?: string }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.url}
      className={cx(
        "semantic-pill inline-flex min-h-7 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-small font-medium text-ink hover:border-ink",
        className,
      )}
    >
      Open on {platformName(link)}
      <span aria-hidden="true">↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
