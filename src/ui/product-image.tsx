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
  // The box has the same shape as the generated art (its aspect ratio). The photo fills the box
  // exactly and `object-contain` scales it down to fit whole, whatever its own shape: a tall pack
  // photo gets space at the sides, a wide box photo space above and below. (`max-height: 100%`
  // alone doesn't work here: the box's height comes only from its aspect ratio.)
  return (
    <div className={`relative w-full ${ASPECT[art.shape]}`}>
      {/* Plain <img>: pre-sized WebP from our own disk, lazily loaded. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/artwork/${imageId}/small`}
        srcSet={`/api/artwork/${imageId}/small 400w, /api/artwork/${imageId}/large 900w`}
        sizes={sizes}
        alt={`${art.setName} ${art.label}`}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-contain drop-shadow-lg"
      />
    </div>
  );
}

/**
 * A set's official key art, whole: WPN's key art is a wide banner (1920 × 699, about 2.75 : 1),
 * so it's shown in a frame of that shape and scaled to fit, never cropped. `className` adds
 * rounding and shadows, not a size.
 */
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
      className={`aspect-[1920/699] w-full object-contain ${props.className ?? ""}`}
    />
  );
}
