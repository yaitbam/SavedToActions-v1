import { ExtractionTelemetry } from "../../ui/ExtractionTelemetry";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Credits } from "../auth/Credits";
import { CloseIcon, CropIcon, ImageIcon, LinkIcon, SwapIcon } from "./icons";
import { ApiError } from "../../api/client";
import { errorText } from "../../api/errors";
import { createSave, retryExtraction } from "../../api/saves";
import { Button } from "../../ui/Button";
import { InlineAlert } from "../../ui/InlineAlert";
import { HOW_LONG_CHIPS, NOTE_MAX, WHEN_CHIPS, addToNote, pullLinkOut } from "./note";
import "./dialog.css";
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
  // The original post, kept as a reference. It is never opened or read by the app, only stored.
  const [link, setLink] = useState("");
  const [movedLink, setMovedLink] = useState(false);
  const lastSent = useRef<string | null>(null);
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
    // The same import key lets a retry after a dropped connection be recognised. A different file, note or link is
    // a different import, so it gets a new key.
    const signature = JSON.stringify([file?.name, file?.size, note.trim(), link.trim()]);
    if (lastSent.current !== null && lastSent.current !== signature) idempotencyKey.current = crypto.randomUUID();
    lastSent.current = signature;
    setPhase("working");
    try {
      const result =
        retrySaveId.current !== null
          ? await retryExtraction(retrySaveId.current)
          : await createSave(file as File, note.trim() || undefined, idempotencyKey.current, link.trim() || undefined);
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
  const pasteKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘V" : "Ctrl+V";

  // People paste the post address into the note. It belongs in its own field, away from the model.
  function onNote(value: string) {
    const pulled = link.trim() ? null : pullLinkOut(value);
    if (pulled) {
      setNote(pulled.note);
      setLink(pulled.link);
      setMovedLink(true);
    } else {
      setNote(value.slice(0, NOTE_MAX));
    }
  }
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
      aria-labelledby="ns-title"
      className="ns-dialog"
    >
      {cropping && original ? (
        <div className="ns-pad">
          <CropEditor file={original} onApply={(next) => finishCrop(next)} onCancel={() => setCropping(false)} />
        </div>
      ) : (
        <div className="ns">
          <header className="ns-head">
            <h2 id="ns-title" className="ns-title">New save</h2>
            <div className="ns-head-side">
              <Credits compact />
              <button type="button" className="ns-close" aria-label="Close" onClick={onClose} disabled={working}><CloseIcon /></button>
            </div>
          </header>
          <p className="ns-sub">A screenshot and one line. Muse finds the time, you approve it.</p>

          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => choose(event.target.files?.[0])}
          />

          {!preview ? (
            <button type="button" className="ns-drop" onClick={() => input.current?.click()}>
              <span className="ns-drop-icon" aria-hidden="true"><ImageIcon /></span>
              <b>Drop, paste or choose a screenshot</b>
              <span>PNG, JPEG or WebP. On a computer you can paste with {pasteKey}.</span>
            </button>
          ) : (
            <div className="ns-grid">
              <figure className="ns-shot">
                <div className="ns-frame">
                  <img src={preview} alt="Your screenshot" />
                  {cropped && <span className="ns-badge">Cropped</span>}
                </div>
                {!working && (
                  <figcaption className="ns-shot-tools">
                    {canCrop && (
                      <button type="button" className="ns-tool" onClick={() => setCropping(true)}><CropIcon />{cropped ? "Crop again" : "Crop"}</button>
                    )}
                    {canCrop && cropped && <button type="button" className="ns-tool" onClick={() => finishCrop(null)}>Undo crop</button>}
                    <button type="button" className="ns-tool" onClick={() => input.current?.click()}><SwapIcon />Change</button>
                  </figcaption>
                )}
              </figure>

              {working ? (
                <ExtractionTelemetry />
              ) : (
                <div className="ns-form">
                  <div className="ns-field">
                    <label htmlFor="ns-note" className="ns-label">What should Muse do, and when?</label>
                    <div className="ns-box">
                      <textarea
                        id="ns-note"
                        value={note}
                        onChange={(event) => onNote(event.target.value)}
                        maxLength={NOTE_MAX}
                        placeholder="For example: tonight, 30 min"
                        rows={2}
                      />
                      <span className="ns-count" aria-live="off">{note.length}/{NOTE_MAX}</span>
                    </div>
                    <div className="ns-chips" role="group" aria-label="Quick phrases">
                      <span className="ns-chips-label">When</span>
                      {WHEN_CHIPS.map((chip) => (
                        <button key={chip} type="button" className="ns-chip" onClick={() => setNote((current) => addToNote(current, chip))}>{chip}</button>
                      ))}
                    </div>
                    <div className="ns-chips" role="group" aria-label="Quick durations">
                      <span className="ns-chips-label">How long</span>
                      {HOW_LONG_CHIPS.map((chip) => (
                        <button key={chip} type="button" className="ns-chip" onClick={() => setNote((current) => addToNote(current, chip))}>{chip}</button>
                      ))}
                    </div>
                  </div>

                  <div className="ns-field">
                    <label htmlFor="ns-link" className="ns-label">Link to the post <span>(optional)</span></label>
                    <div className="ns-input">
                      <LinkIcon />
                      <input
                        id="ns-link"
                        type="url"
                        inputMode="url"
                        value={link}
                        onChange={(event) => { setLink(event.target.value); setMovedLink(false); }}
                        placeholder="Paste the link from X, LinkedIn or Instagram"
                      />
                    </div>
                    <p className="ns-hint">
                      {movedLink ? "We moved the link out of your note. " : ""}
                      Kept so you can open the post later. Muse never reads it.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === "error" && <InlineAlert>{message}</InlineAlert>}

          <footer className="ns-foot">
            <p className="ns-fine">Muse reads only when and how long. Nothing is booked until you approve a time.</p>
            <div className="ns-actions">
              <Button variant="text" onClick={onClose} disabled={working}>Cancel</Button>
              {!file && retrySaveId.current === null ? (
                <Button onClick={() => input.current?.click()}>Choose a screenshot</Button>
              ) : (
                <>
                  <span className="ns-cost">Uses 1 credit</span>
                  <Button onClick={extract} loading={working}>{phase === "error" ? "Retry" : "Extract"}</Button>
                </>
              )}
            </div>
          </footer>
        </div>
      )}
    </dialog>
  );
}
