import { Chip } from "./Chip";

import { modelLabelFromId, useModelLabel } from "../api/model";

// The model that really read this save (its stored id), or the active one when the id is not known.
export function ModelChip({ ms, model }: { ms?: number | null; model?: string | null }) {
  const active = useModelLabel();
  const seconds = typeof ms === "number" ? ` · ${(ms / 1000).toFixed(1)} s` : "";
  return <Chip tone="accent">Read by {modelLabelFromId(model) ?? active}{seconds}</Chip>;
}
