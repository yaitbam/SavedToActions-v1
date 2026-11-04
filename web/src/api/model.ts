import { useEffect, useState } from "react";
import { getSession } from "./session";

// What the server says about the model it is using now. The text on every page comes from this, never from fixed words.
export interface ModelInfo {
  provider: "baseten" | "meta" | string | null;
  id: string | null;
  label: string | null;
  openWeights: boolean;
}

// The same rule as the server: only the Muse Spark Open model is open weights. Any other id is shown as it is.
export function modelLabelFromId(id: string | null | undefined): string | null {
  if (!id) return null;
  return /muse-spark-open/i.test(id) ? "Muse Spark Open" : id;
}

let pending: Promise<ModelInfo | null> | null = null;
function loadModel(): Promise<ModelInfo | null> {
  pending ??= getSession().then((session) => session.model ?? null).catch(() => { pending = null; return null; });
  return pending;
}

// Until the answer arrives, or when it cannot be read, no model is named. Nothing is claimed that may be wrong.
export const UNKNOWN_MODEL = "Muse";

export function useModelInfo(): ModelInfo | null {
  const [info, setInfo] = useState<ModelInfo | null>(null);
  useEffect(() => {
    let live = true;
    void loadModel().then((value) => { if (live) setInfo(value); });
    return () => { live = false; };
  }, []);
  return info;
}

export function useModelLabel(): string {
  return useModelInfo()?.label ?? UNKNOWN_MODEL;
}

export function providerSentence(info: ModelInfo | null): string {
  if (info?.provider === "meta") return "called through the Meta Model API";
  if (info?.provider === "baseten") return "called through Baseten";
  return "called through an API";
}
