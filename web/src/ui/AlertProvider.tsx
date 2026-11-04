import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chip } from "./Chip";

type Tone = "error" | "warning";

interface Item {
  id: number;
  tone: Tone;
  message: string;
  title?: string;
}

interface Options {
  // Names what failed when the message alone would be generic.
  title?: string;
}

interface AlertApi {
  error: (message: string, options?: Options) => void;
  warning: (message: string, options?: Options) => void;
}

const AlertContext = createContext<AlertApi | null>(null);

const MAX_VISIBLE = 3;
const WARNING_MS = 8000;

export function useAlert(): AlertApi {
  const api = useContext(AlertContext);
  if (!api) throw new Error("useAlert needs AlertProvider");
  return api;
}

// One stack of popups for failed actions. Errors stay until closed, warnings clear themselves.
// The stack uses the Popover API so it sits in the top layer. Page states and form fields use InlineAlert instead.
export function AlertProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const stack = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const push = useCallback(
    (tone: Tone, message: string, title?: string) => {
      const id = ++counter.current;
      // The same message replaces its earlier copy, so a repeated failure does not pile up.
      setItems((current) =>
        [...current.filter((item) => item.message !== message || item.title !== title), { id, tone, message, title }].slice(-MAX_VISIBLE),
      );
      if (tone === "warning") setTimeout(() => dismiss(id), WARNING_MS);
    },
    [dismiss],
  );

  const api = useMemo<AlertApi>(
    () => ({
      error: (message, options) => push("error", message, options?.title),
      warning: (message, options) => push("warning", message, options?.title),
    }),
    [push],
  );

  useEffect(() => {
    const node = stack.current;
    if (!node) return;
    const open = node.matches(":popover-open");
    if (items.length > 0 && !open) node.showPopover();
    if (items.length === 0 && open) node.hidePopover();
  }, [items.length]);

  return (
    <AlertContext.Provider value={api}>
      {children}
      <div
        ref={stack}
        popover="manual"
        className="fixed inset-auto bottom-20 left-4 right-4 m-0 flex flex-col gap-3 overflow-visible border-0 bg-transparent p-0 md:bottom-6 md:left-auto md:right-6 md:w-96"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className="animate-enter rounded-card border-[1.5px] border-ink bg-surface p-4 text-ink shadow-hard"
          >
            <div className="flex items-center justify-between gap-3">
              <Chip tone={item.tone === "error" ? "nofit" : "conflict"}>{item.tone === "error" ? "Error" : "Warning"}</Chip>
              <button type="button" onClick={() => dismiss(item.id)} className="text-small font-medium underline underline-offset-4">
                Close
              </button>
            </div>
            {item.title && <p className="mt-3 font-semibold">{item.title}</p>}
            <p className={item.title ? "mt-1 text-small" : "mt-3 font-medium"}>{item.message}</p>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  );
}
