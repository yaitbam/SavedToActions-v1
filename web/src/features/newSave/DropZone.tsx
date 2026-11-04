import { useRef } from "react";
import { Button } from "../../ui/Button";
import { isSupportedImage, useNewSave } from "./NewSaveContext";

// One line on Home. Drop and paste are handled for the whole window by the provider.
export function DropZone() {
  const { open } = useNewSave();
  const input = useRef<HTMLInputElement>(null);

  function pick(file: File | undefined) {
    // An unsupported file opens the dialog empty, where the format message is shown.
    open(file && isSupportedImage(file) ? file : undefined);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-card border-2 border-dashed border-line bg-surface px-5 py-3">
      <p className="min-w-0">
        <span className="font-semibold">Drop or paste a screenshot of a post you saved</span>
        <span className="block text-small text-muted md:ml-3 md:inline">You review it before anything is booked</span>
      </p>
      <Button variant="secondary" onClick={() => input.current?.click()}>
        Choose a screenshot
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
