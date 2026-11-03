import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface PopoverProps {
  label: string;
  children: ReactNode;
}

// A text link that opens a small panel. Closes on outside click and Escape.
export function Popover({ label, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={root} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="text-small font-medium text-brand underline-offset-4 hover:underline"
      >
        {label}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          className="animate-enter absolute left-0 top-full z-20 mt-2 w-72 rounded-thumb bg-surface p-4 text-small text-ink shadow-card"
        >
          {children}
        </div>
      )}
    </span>
  );
}
