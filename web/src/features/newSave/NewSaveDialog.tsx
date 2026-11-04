import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { errorText } from "../../api/errors";
import { createSave, retryExtraction } from "../../api/saves";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { fieldClass } from "../../ui/cx";
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
  const [file, setFile] = useState<File | null>(initialFile);
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
    setFile(next);
    setPhase("pick");
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

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event) => working && event.preventDefault()}
      onClick={(event) => event.target === dialog.current && !working && onClose()}
      aria-label="New save"
      className="m-auto w-[min(34rem,92vw)] rounded-card border-[1.5px] border-ink bg-surface p-6 shadow-hard backdrop:bg-ink/60"
    >
      <div className="space-y-4">
        <h2 className="text-title">New save</h2>

        {preview ? (
          <div className="flex gap-4">
            <img src={preview} alt="Your screenshot" className="h-48 w-40 shrink-0 rounded-thumb border border-line object-cover object-top" />
            <div className="min-w-0 flex-1 space-y-3">
              {working ? (
                <div role="status" className="space-y-3">
                  <p className="font-semibold">Muse Spark Open is reading your screenshot</p>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
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
                <Button variant="text" onClick={() => input.current?.click()}>
                  Choose another
                </Button>
              )}
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

        {phase === "error" && (
          <p role="alert" className="text-small text-nofit">
            {message}
          </p>
        )}

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
    </dialog>
  );
}
