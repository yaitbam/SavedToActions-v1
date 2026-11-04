export const fieldClass =
  "h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:text-muted";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
