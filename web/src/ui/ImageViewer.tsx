import { useEffect, useRef } from "react";

interface ImageViewerProps {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}

export function ImageViewer({ src, alt, open, onClose }: ImageViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      aria-label={alt}
      className="m-auto max-h-[92vh] max-w-[92vw] overflow-hidden rounded-card bg-surface p-0 shadow-card backdrop:bg-ink/70"
    >
      {open && (
        <div className="relative animate-enter">
          <img src={src} alt={alt} className="block max-h-[92vh] max-w-[92vw] object-contain" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 h-10 rounded-full bg-surface px-4 text-small font-semibold text-ink shadow-card"
          >
            Close
          </button>
        </div>
      )}
    </dialog>
  );
}
