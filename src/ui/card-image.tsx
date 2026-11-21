"use client";
// The one place an image is drawn. It is a plain <img>, not `next/image`, on purpose: every image
// here comes from our own disk cache (`/api/images`, `/api/artwork`), which already serves
// pre-sized WebP in a few widths, so the optimiser would only repeat that work. What this adds:
//   - `alt` is required. A purely decorative image says so with `decorative` instead of `alt=""`.
//   - lazy loading unless told otherwise, and `width` / `height` (or an aspect-ratio class) to
//     stop the page jumping while it loads.
//   - a plain tile with the alt text when the image fails to load, so a broken image never leaves
//     an empty hole. (Lint bans a raw <img> anywhere else in src/app and src/ui.)
import { useState, type ComponentProps } from "react";

type ImageProps = Omit<ComponentProps<"img">, "alt" | "children">;
type Description = { alt: string; decorative?: never } | { decorative: true; alt?: never };

export type CardImageProps = ImageProps & Description;

export function CardImage(props: CardImageProps) {
  const { alt, decorative, loading = "lazy", className, ...rest } = props;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : alt}
        aria-hidden={decorative ? true : undefined}
        className={`bg-surface-raised text-muted flex items-center justify-center p-1 text-center text-xs ${className ?? ""}`}
      >
        {decorative ? null : alt}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element, no-restricted-syntax -- the one allowed raw <img>, see above
    <img
      {...rest}
      alt={decorative ? "" : alt}
      loading={loading}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
