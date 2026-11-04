import { useState } from "react";
import { ImageViewer } from "../../ui/ImageViewer";
import { Thumb } from "../../ui/Thumb";
import { cx } from "../../ui/cx";

export const illustrativePosts = [
  { file: "03.png", alt: "Fictional prompt.kitchen saved post about turning meeting notes into actions", label: "A prompt to try", tone: "prompt" },
  { file: "04.png", alt: "Fictional coldinbox.club saved post with a cold email template", label: "A template to use", tone: "template" },
  { file: "09.png", alt: "Fictional folio.fixes saved post about writing a portfolio case study", label: "A skill to practise", tone: "skill" },
];

interface FixtureCardProps {
  post: (typeof illustrativePosts)[number];
  className?: string;
}

export function FixtureCard({ post, className }: FixtureCardProps) {
  const [open, setOpen] = useState(false);
  const src = `/demo/${post.file}`;
  return (
    <figure className={cx("landing-note", `landing-note-${post.tone}`, className)}>
      <Thumb src={src} alt={post.alt} onOpen={() => setOpen(true)} />
      <figcaption>{post.label}</figcaption>
      <ImageViewer src={src} alt={post.alt} open={open} onClose={() => setOpen(false)} />
    </figure>
  );
}
