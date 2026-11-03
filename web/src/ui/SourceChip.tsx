import { Chip } from "./Chip";

const labels: Record<string, string> = {
  matched_note: "From your note",
  matched_transcription: "From the post",
  edited: "Edited by you",
};

interface SourceChipProps {
  badge: string | null;
  badgeLabel?: string | null;
}

// A field with no source shows nothing. Empty values are hidden, never explained.
export function SourceChip({ badge, badgeLabel }: SourceChipProps) {
  if (!badge) return null;
  const label = labels[badge] ?? badgeLabel;
  if (!label) return null;
  return <Chip tone={badge === "edited" ? "brand" : "neutral"}>{label}</Chip>;
}
