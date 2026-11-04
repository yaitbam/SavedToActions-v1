import { ExtractionTelemetry } from "../../ui/ExtractionTelemetry";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Credits } from "../auth/Credits";
import { ApiError } from "../../api/client";
import { errorText } from "../../api/errors";
import { createSave, retryExtraction } from "../../api/saves";
import { Button } from "../../ui/Button";
import { InlineAlert } from "../../ui/InlineAlert";
import { fieldClass } from "../../ui/cx";
import { CropEditor } from "./CropEditor";
import { isSupportedImage } from "./NewSaveContext";

interface Props {
  initialFile: File | null;
  onClose: () => void;
}

type Phase = "pick" | "working" | "error";

export function NewSaveDialog({ initialFile, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  // The file as picked, and the file to upload. They differ once the user has cropped.
  const [original, setOriginal] = useState<File | null>(initialFile);
  const [file, setFile] = useState<File | null>(initialFile);
  const [cropping, setCropping] = useState(false);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("pick");
  const [message, setMessage] = useState("");
  const retrySaveId = useRef<number | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(next: File | undefined) {
    if (!next) return;
    if (!isSupportedImage(next)) {
      setMessage("Use a PNG, JPEG or WebP image");
      setPhase("error");
      return;
    }
    setOriginal(next);
    setFile(next);
    setPhase("pick");
    idempotencyKey.current = crypto.randomUUID();
  }

  // A different image is a different import, so it gets its own key.
  function finishCrop(next: File | null) {
    setFile(next ?? original);
    setCropping(false);
    idempotencyKey.current = crypto.randomUUID();
  }

  async function extract() {
    if (!file && retrySaveId.current === null) return;
    setPhase("working");
    try {
      const result =
        retrySaveId.current !== null
          ? await retryExtraction(retrySaveId.current)
          : await createSave(file as File, note.trim() || undefined, idempotencyKey.current);
      onClose();
      navigate(`/app/saves/${result.saveId}`);
    } catch (e) {
      const savedId = e instanceof ApiError ? (e.body as { saveId?: unknown } | null)?.saveId : undefined;
      if (typeof savedId === "number") retrySaveId.current = savedId;
      if (e instanceof ApiError && e.code === "already_extracted" && retrySaveId.current !== null) {
        onClose();
        navigate(`/app/saves/${retrySaveId.current}`);
        return;
      }
      setMessage(errorText(e, "Extraction failed. Try again"));
      setPhase("error");
    }
  }

  const working = phase === "working";
  const cropped = !!file && file !== original;
  // Once a save exists on the server (a retry), its picture can no longer change here.
  const canCrop = !!original && retrySaveId.current === null && !working;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // Escape closes the crop editor first, not the whole dialog.
      onCancel={(event) => {
        if (working) event.preventDefault();
        else if (cropping) { event.preventDefault(); setCropping(false); }
      }}
      onClick={(event) => event.target === dialog.current && !working && onClose()}
      aria-label="New save"
      className="m-auto w-[min(44rem,94vw)] rounded-card border border-line bg-surface p-6 shadow-hard backdrop:bg-ink/60"
    >
      {cropping && original ? (
        <CropEditor file={original} onApply={(next) => finishCrop(next)} onCancel={() => setCropping(false)} />
      ) : (
      <div className="space-y-4">
        <h2 className="text-title">New save</h2>
        <Credits />

        {preview ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            <img src={preview} alt="Your screenshot" className="h-48 w-40 shrink-0 rounded-thumb border border-line object-cover object-top" />
            <div className="min-w-0 flex-1 space-y-3">
              {working ? (
                <ExtractionTelemetry />
              ) : (
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="What do you want to do with it? (optional)"
                  rows={5}
                  className={`${fieldClass} h-auto resize-none py-3`}
                />
              )}
              {!working && (
                <div className="flex flex-wrap items-center gap-1">
                  {canCrop && (
                    <Button variant="secondary" className="h-10 px-4" onClick={() => setCropping(true)}>
                      {cropped ? "Crop again" : "Crop"}
                    </Button>
                  )}
                  {canCrop && cropped && (
                    <Button variant="text" onClick={() => finishCrop(null)}>
                      Undo crop
                    </Button>
                  )}
                  <Button variant="text" onClick={() => input.current?.click()}>
                    Choose another
                  </Button>
                </div>
              )}
              {!working && cropped && <p className="text-small text-muted">Cropped. Only the part you kept is uploaded.</p>}
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col items-start gap-1 rounded-card border-2 border-dashed border-line p-6">
            <span className="font-semibold">Drop or paste a screenshot of a post you saved</span>
            <span className="text-small text-muted">You review it before anything is booked</span>
          </div>
        )}

        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => choose(event.target.files?.[0])}
        />

        {phase === "error" && <InlineAlert>{message}</InlineAlert>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="text" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          {!file && retrySaveId.current === null ? (
            <Button onClick={() => input.current?.click()}>Choose a screenshot</Button>
          ) : (
            <Button onClick={extract} loading={working}>
              {phase === "error" ? "Retry" : "Extract"}
            </Button>
          )}
        </div>
      </div>
      )}
    </dialog>
  );
}
