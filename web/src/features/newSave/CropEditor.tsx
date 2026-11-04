import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../../ui/Button";
import "./crop.css";

// The crop box as fractions of the image, so it does not depend on how large the image is drawn.
interface Box { x: number; y: number; w: number; h: number }
type Grip = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "move";

const MIN = 0.05;
const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };
const GRIPS: Grip[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const EDGE_LABEL: Record<string, string> = { n: "top", s: "bottom", w: "left", e: "right" };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// Moves one edge, one corner, or the whole box by a fraction of the image.
export function moveBox(box: Box, grip: Grip, dx: number, dy: number): Box {
  if (grip === "move") return { ...box, x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h) };
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  if (grip.includes("w")) left = clamp(left + dx, 0, right - MIN);
  if (grip.includes("e")) right = clamp(right + dx, left + MIN, 1);
  if (grip.includes("n")) top = clamp(top + dy, 0, bottom - MIN);
  if (grip.includes("s")) bottom = clamp(bottom + dy, top + MIN, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const isFull = (box: Box) => box.x <= 0 && box.y <= 0 && box.w >= 1 && box.h >= 1;

// Cuts the box out of the original pixels in the browser. Nothing outside the box is ever uploaded.
export async function cropFile(file: File, box: Box): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const sx = Math.round(box.x * bitmap.width);
  const sy = Math.round(box.y * bitmap.height);
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(box.w * bitmap.width)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(box.h * bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const jpeg = file.type === "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, jpeg ? "image/jpeg" : "image/png", 0.92));
  if (!blob) throw new Error("crop_failed");
  const base = file.name.replace(/\.[^.]+$/, "") || "screenshot";
  return new File([blob], `${base}-cropped.${jpeg ? "jpg" : "png"}`, { type: blob.type });
}

interface Props {
  file: File;
  onApply: (cropped: File) => void;
  onCancel: () => void;
}

// Lets the user cut a screenshot down to the post: the phone status bar, the bottom bar and the next posts go.
export function CropEditor({ file, onApply, onCancel }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box>(FULL);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ grip: Grip; x: number; y: number; box: Box } | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    setBox(FULL);
    setNatural(null);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  function start(grip: Grip, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { grip, x: event.clientX, y: event.clientY, box };
  }

  function move(event: PointerEvent) {
    const current = drag.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!current || !rect?.width || !rect.height) return;
    setBox(moveBox(current.box, current.grip, (event.clientX - current.x) / rect.width, (event.clientY - current.y) / rect.height));
  }

  function end() {
    drag.current = null;
  }

  // Arrow keys move the edge the handle sits on. Shift moves it further.
  function key(grip: Grip, event: KeyboardEvent) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const hit = delta[event.key];
    if (!hit) return;
    event.preventDefault();
    setBox((current) => moveBox(current, grip, hit[0], hit[1]));
  }

  async function apply() {
    if (isFull(box)) {
      onCancel();
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      onApply(await cropFile(file, box));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  const pixels = natural ? `${Math.round(box.w * natural.w)} × ${Math.round(box.h * natural.h)} px` : null;

  return (
    <div className="crop">
      <h2 className="text-title">Crop your screenshot</h2>
      <p className="crop-help">
        Drag the edges to keep only the post. Cut out the phone status bar, the bottom bar and any other posts.
        Cropping happens in your browser, so the parts you cut are never uploaded.
      </p>
      <div className="crop-wrap">
        <div ref={stage} className="crop-stage">
          {url && (
            <img
              src={url}
              alt="Your screenshot, before cropping"
              className="crop-img"
              draggable={false}
              onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            />
          )}
          <div
            className="crop-box"
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
            onPointerDown={(event) => start("move", event)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {GRIPS.map((grip) => {
              const edge = grip.length === 1;
              return (
                <button
                  key={grip}
                  type="button"
                  className={`crop-grip crop-grip-${grip}`}
                  tabIndex={edge ? 0 : -1}
                  aria-hidden={edge ? undefined : true}
                  aria-label={edge ? `Move the ${EDGE_LABEL[grip]} edge. Use the arrow keys` : undefined}
                  onPointerDown={(event) => start(grip, event)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={(event) => key(grip, event)}
                />
              );
            })}
          </div>
        </div>
      </div>
      <p className="crop-size" role="status">{isFull(box) ? "Nothing cut yet" : pixels ? `Keeping ${pixels}` : ""}</p>
      {failed && <p className="crop-error" role="alert">Could not crop this image. Use it as it is, or try another one.</p>}
      <div className="crop-actions">
        <Button type="button" variant="text" onClick={() => setBox(FULL)} disabled={busy || isFull(box)}>Reset</Button>
        <span className="crop-spacer" />
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={() => void apply()} loading={busy} disabled={isFull(box)}>Use this crop</Button>
      </div>
    </div>
  );
}
