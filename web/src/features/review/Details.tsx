import type { ReactNode } from "react";
import { listChecks } from "../../api/actions";
import type { Action, ActionPatch, Goal } from "../../api/types";
import { useAsync } from "../../api/useAsync";
import { StatusChip, statusFromCheck } from "../../ui/StatusChip";
import { EditFields } from "./EditFields";
import { Trace } from "./Trace";

interface Props {
  action: Action;
  goals: Goal[];
  open: boolean;
  busy: boolean;
  onToggle: (open: boolean) => void;
  onPatch: (changes: ActionPatch) => void;
  onLink: (link: string | null) => void;
  label?: string;
}

const verbatimLabel = { prompt: "Prompt", link: "Link", keyword: "Keyword" } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-display text-base">{title}</h3>
      {children}
    </section>
  );
}

function CheckHistory({ action }: { action: Action }) {
  const history = useAsync(() => listChecks(action.id, 20), [action.id, action.check?.id]);
  const checks = history.data?.checks ?? [];
  if (checks.length === 0) return null;
  return (
    <Section title="Check history">
      <ul className="space-y-2">
        {checks.map((check) => (
          <li key={check.id} className="flex flex-wrap items-center gap-2 text-small">
            <StatusChip status={statusFromCheck(check.state)} />
            <span>{check.checkedAtRelative}</span>
            <span className="text-muted">{check.source === "watcher" ? "Watcher" : "You"}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Details({ action, goals, open, busy, onToggle, onPatch, onLink, label = "Details" }: Props) {
  return (
    <details
      open={open}
      onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}
      className="rounded-card border border-line bg-surface p-6"
    >
      <summary className="cursor-pointer font-display font-semibold tracking-tight">{label}</summary>
      {open && (
        <div className="mt-4 space-y-6">
          <EditFields action={action} goals={goals} busy={busy} onPatch={onPatch} onLink={onLink} />
          {action.deliverables.length > 0 && (
            <Section title="Deliverables">
              <ul className="list-disc space-y-1 pl-5">
                {action.deliverables.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Section>
          )}
          {action.verbatimItems.length > 0 && (
            <Section title="From the post">
              <ul className="space-y-2">
                {action.verbatimItems.map((item) => (
                  <li key={`${item.type}-${item.text}`} className="space-y-1">
                    <span className="text-small text-muted">{verbatimLabel[item.type]}</span>
                    <p className="whitespace-pre-wrap break-words rounded-xl bg-bg p-3">{item.text}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <CheckHistory action={action} />
          <Trace actionId={action.id} />
        </div>
      )}
    </details>
  );
}
