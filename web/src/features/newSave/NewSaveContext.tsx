import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "../auth/SessionContext";
import { NewSaveDialog } from "./NewSaveDialog";

interface NewSaveApi {
  open: (file?: File) => void;
}

const NewSaveContext = createContext<NewSaveApi>({ open: () => undefined });

export const useNewSave = () => useContext(NewSaveContext);

export const isSupportedImage = (file: File) => /^image\/(png|jpeg|webp)$/.test(file.type);

// Owns the dialog. Paste or drop of an image anywhere in the app opens it with that file.
export function NewSaveProvider({ children }: { children: ReactNode }) {
  const { session: identity } = useSession();
  const [session, setSession] = useState<{ id: number; file: File | null } | null>(null);

  const open = useCallback((file?: File) => {
    if (identity?.kind === "demo") return;
    setSession((current) => ({ id: (current?.id ?? 0) + 1, file: file ?? null }));
  }, [identity?.kind]);

  useEffect(() => {
    const firstImage = (files?: FileList | null) => Array.from(files ?? []).find(isSupportedImage);
    const onPaste = (event: ClipboardEvent) => {
      const file = firstImage(event.clipboardData?.files);
      if (!file) return;
      event.preventDefault();
      open(file);
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const file = firstImage(event.dataTransfer?.files);
      event.preventDefault();
      if (file) open(file);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [open]);

  return (
    <NewSaveContext.Provider value={{ open }}>
      {children}
      {session && <NewSaveDialog key={session.id} initialFile={session.file} onClose={() => setSession(null)} />}
    </NewSaveContext.Provider>
  );
}
