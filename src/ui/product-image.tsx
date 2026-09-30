import { ASPECT, ProductArt, type ProductArtProps } from "./product-art";

// A sealed product's picture (design doc 13): Wizards' official photo when the sync downloaded
// one, otherwise the generated packaging art. Photos are shown whole, never cropped or covered,
// so the logos and legal lines printed on the packaging stay intact.

type ProductImageProps = ProductArtProps & {
  /** Official photos (artwork image ids); empty for generated art. */
  photoIds: readonly string[];
  /** Which photo to show when there are several (e.g. one of three pack arts). */
  variant?: number;
  /** How wide it's shown, for the browser to pick a size (the `sizes` attribute). */
  sizes?: string;
};

export function ProductImage(props: ProductImageProps) {
  const { photoIds, variant = 0, sizes = "(min-width: 1024px) 25vw, 50vw", ...art } = props;
  if (photoIds.length === 0) return <ProductArt {...art} />;

  const imageId = photoIds[variant % photoIds.length];
  return (
    <div className={`flex w-full items-center justify-center ${ASPECT[art.shape]}`}>
      {/* Plain <img>: pre-sized WebP from our own disk, lazily loaded. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/artwork/${imageId}/small`}
        srcSet={`/api/artwork/${imageId}/small 400w, /api/artwork/${imageId}/large 900w`}
        sizes={sizes}
        alt={`${art.setName} ${art.label}`}
        loading="lazy"
        className="max-h-full max-w-full object-contain drop-shadow-lg"
      />
    </div>
  );
}

/** A set's official key art as a banner or tile, or nothing when it has none. */
export function KeyArt(props: {
  imageId: string;
  alt: string;
  className?: string;
  sizes?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/artwork/${props.imageId}/small`}
      srcSet={`/api/artwork/${props.imageId}/small 640w, /api/artwork/${props.imageId}/large 1920w`}
      sizes={props.sizes ?? "100vw"}
      alt={props.alt}
      loading="lazy"
      className={props.className}
    />
  );
}
