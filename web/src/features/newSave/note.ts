// The note is a one line instruction, so the length is short on purpose. The server enforces the same limit.
export const NOTE_MAX = 160;

// Taps that add the usual words, so a note takes a second on a phone.
export const NOTE_CHIPS = ["Tonight", "Tomorrow morning", "This weekend", "15 min", "30 min", "1 hour"] as const;

export function addToNote(note: string, phrase: string): string {
  const base = note.trim().replace(/[,\s]+$/, "");
  const next = base ? `${base}, ${phrase.toLowerCase()}` : phrase;
  return next.length > NOTE_MAX ? note : next;
}

const SOCIAL = "(?:x|twitter|linkedin|instagram|tiktok|threads|facebook|youtube)\\.com|youtu\\.be|lnkd\\.in|instagr\\.am|fb\\.watch";
const URL_IN_TEXT = new RegExp(`(?:https?:\\/\\/\\S+|(?:www\\.)?(?:${SOCIAL})\\/\\S+)`, "i");

// Finds a post address pasted into the note. Returns the note without it, and the address.
export function pullLinkOut(note: string): { note: string; link: string } | null {
  const found = note.match(URL_IN_TEXT);
  if (!found) return null;
  const link = found[0].replace(/[.,;:!?)\]"']+$/, "");
  const rest = note.replace(found[0], " ").replace(/\s{2,}/g, " ").trim();
  return { note: rest.slice(0, NOTE_MAX), link };
}
