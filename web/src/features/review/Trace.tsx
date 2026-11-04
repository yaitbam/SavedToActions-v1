import { getTrace, listTraces } from "../../api/traces";
import { modelLabelFromId, useModelLabel } from "../../api/model";
import { useAsync } from "../../api/useAsync";

// Newest planning trace for this save. Hidden while loading and when there is none.
export function Trace({ actionId }: { actionId: number }) {
  const latest = useAsync(async () => {
    const { traces } = await listTraces(actionId);
    if (traces.length === 0) return null;
    return (await getTrace(traces[0].id)).trace;
  }, [actionId]);

  const active = useModelLabel();
  const trace = latest.data;
  const steps = trace?.steps.filter((step) => step.label) ?? [];
  if (!trace || steps.length === 0) return null;

  return (
    <section className="rounded-card border border-line bg-bg p-5">
      <h3 className="font-display text-base">How {modelLabelFromId(trace.model) ?? active} planned this</h3>
      {trace.instruction && <p className="text-small text-muted">“{trace.instruction}”</p>}
      <ol className="mt-4 space-y-3 font-mono text-[14px]">
        {steps.map((step) => (
          <li key={step.n} className="flex gap-3 border-t border-line pt-3">
            <span className="w-5 shrink-0 text-muted">{step.n}</span>
            <span className="min-w-0 flex-1">{step.type === "error" ? "Something went wrong while planning. Please try again" : step.label}</span>
            {step.ms != null && <span className="shrink-0 text-muted">{step.ms} ms</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
