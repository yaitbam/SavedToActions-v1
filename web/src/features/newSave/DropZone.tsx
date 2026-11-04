import { useNewSave } from "./NewSaveContext";

export function DropZone() {
  const { open } = useNewSave();
  return (
    <button
      type="button"
      onClick={() => open()}
      className="flex w-full flex-col items-start gap-1 rounded-card border-2 border-dashed border-line bg-surface p-6 text-left transition-colors duration-150 hover:border-ink"
    >
      <span className="font-semibold">Drop or paste a screenshot of a post you saved</span>
      <span className="text-small text-muted">You review it before anything is booked</span>
    </button>
  );
}
