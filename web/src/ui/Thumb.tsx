import { useState } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";

interface ThumbProps {
  src: string;
  alt: string;
  onOpen?: () => void;
  className?: string;
}

// 4:5 screenshot thumbnail. Click opens the full size viewer when onOpen is set.
export function Thumb({ src, alt, onOpen, className }: ThumbProps) {
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
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </>
  );

  const frame = cx("relative block aspect-[4/5] w-full overflow-hidden rounded-thumb bg-missing-bg", className);

  if (!onOpen) return <div className={frame}>{image}</div>;
  return (
    <button type="button" onClick={onOpen} aria-label={`Open ${alt}`} className={cx(frame, "cursor-zoom-in")}>
      {image}
    </button>
  );
}
