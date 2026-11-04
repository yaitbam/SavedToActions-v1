import { useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { InstagramIcon, LinkedInIcon, ScreenshotIcon, TikTokIcon, XIcon } from "../../ui/PlatformIcons";
import { isSupportedImage, useNewSave } from "./NewSaveContext";

// Illustrative posts from fixtures/demo. Every account in them is fictional.
const samples = [
  { file: "03.png", label: "A prompt to try" },
  { file: "04.png", label: "A template to use" },
  { file: "09.png", label: "A skill to practise" },
];

const platforms = [
  { name: "Instagram", Icon: InstagramIcon, className: "chip-ig" },
  { name: "X", Icon: XIcon, className: "chip-x" },
  { name: "LinkedIn", Icon: LinkedInIcon, className: "chip-li" },
  { name: "TikTok", Icon: TikTokIcon, className: "chip-tt" },
  { name: "Screenshots", Icon: ScreenshotIcon, className: "chip-ss" },
];

const pasteKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘V" : "Ctrl+V";

// Drop and paste are handled for the whole window by the provider.
// The compact bar is for a workspace that already has saves. The rich card is for the empty state.
export function DropZone({ rich = false }: { rich?: boolean }) {
  const { open } = useNewSave();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  function pick(file: File | undefined) {
    // An unsupported file opens the dialog empty, where the format message is shown.
    open(file && isSupportedImage(file) ? file : undefined);
  }

  async function trySample(name: string) {
    setLoading(name);
    try {
      const response = await fetch(`/demo/${name}`);
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("sample unavailable");
      const blob = await response.blob();
      open(new File([blob], `sample-${name}`, { type: blob.type }));
    } catch {
      open();
    } finally {
      setLoading(null);
    }
  }

  const chooser = (
    <>
      <Button variant={rich ? "primary" : "secondary"} onClick={() => input.current?.click()}>
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
    </>
  );

  if (!rich) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-card border-2 border-dashed border-line bg-surface px-5 py-3 shadow-card">
        <p className="min-w-0">
          <span className="font-semibold">Drop or paste a screenshot of a post you saved</span>
          <span className="mt-1 block text-small text-muted md:ml-3 md:mt-0 md:inline">You review it before anything is booked</span>
        </p>
        {chooser}
      </div>
    );
  }

  return (
    <section className="dropcard" aria-labelledby="dropcard-title">
      <div
        className={`dropcard-zone ${over ? "over" : ""}`}
        onDragEnter={() => setOver(true)}
        onDragOver={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <div className="dropcard-chips" aria-hidden="true">
          {platforms.map(({ name, Icon, className }) => <span key={name} className={`dropcard-chip ${className}`} title={name}><Icon width={22} height={22} /></span>)}
        </div>
        <h2 id="dropcard-title">Drop a screenshot or press <kbd>{pasteKey}</kbd> to paste</h2>
        <p>From Instagram, X, LinkedIn, TikTok or your camera roll. PNG, JPEG or WebP. You review it before anything is booked.</p>
        {chooser}
      </div>
      <div className="dropcard-samples">
        <p className="dropcard-samples-title">Try with a sample social post</p>
        <div className="dropcard-sample-row">
          {samples.map(({ file, label }) => (
            <button key={file} type="button" className="dropcard-sample" disabled={loading !== null} aria-busy={loading === file || undefined} onClick={() => void trySample(file)}>
              <img src={`/demo/${file}`} alt="" loading="lazy" draggable={false} />
              <span>{label}</span>
              <small>Fictional account</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
