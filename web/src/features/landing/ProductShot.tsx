import { useState } from "react";
import { ImageViewer } from "../../ui/ImageViewer";

export function ProductShot({ name, alt }: { name: "review" | "receipt" | "conflict"; alt: string }) {
  const [open, setOpen] = useState(false);
  const src = `/product/${name}.png`;

  return (
    <>
      <button type="button" className="landing-product-shot" onClick={() => setOpen(true)} aria-label={`Open ${alt}`}>
        <img src={src} alt={alt} loading="lazy" />
      </button>
      <ImageViewer src={src} alt={alt} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
