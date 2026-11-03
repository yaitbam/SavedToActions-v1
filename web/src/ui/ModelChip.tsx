import { Chip } from "./Chip";

export function ModelChip({ ms }: { ms?: number | null }) {
  const seconds = typeof ms === "number" ? ` · ${(ms / 1000).toFixed(1)} s` : "";
  return <Chip tone="brand">Read by Muse Spark Open{seconds}</Chip>;
}
