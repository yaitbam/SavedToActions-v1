import { useState } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";

interface ThumbProps {
  src: string;
  alt: string;
  onOpen?: () => void;
  className?: string;
  // Show the whole screenshot at its own proportions (Review). Default is a 4:5 crop.
  natural?: boolean;
}

export function Thumb({ src, alt, onOpen, className, natural = false }: ThumbProps) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  const image = (
    <>
      {state === "loading" && <Skeleton className="absolute inset-0 rounded-none" />}
      {state === "failed" ? (
        <span className="absolute inset-0 flex items-center justify-center bg-missing-bg text-small text-missing">
          Missing
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
          className={cx(
            natural ? "block h-auto max-h-[75vh] w-full object-contain" : "absolute inset-0 size-full object-cover",
            natural && state !== "ready" && "min-h-64",
          )}
        />
      )}
    </>
  );

  const frame = cx(
    "relative block w-full overflow-hidden rounded-thumb bg-missing-bg",
    !natural && "aspect-[4/5]",
    className,
  );

  if (!onOpen) return <div className={frame}>{image}</div>;
  return (
    <button type="button" onClick={onOpen} aria-label={`Open ${alt}`} className={cx(frame, "cursor-zoom-in")}>
      {image}
    </button>
  );
}
