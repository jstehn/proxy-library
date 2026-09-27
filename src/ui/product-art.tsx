// Generated packaging art for sealed products and sets (design doc 06, section 10), used until
// real product photos are allowed (docs/future-ideas.md). Pure HTML and CSS: the set's own colors,
// its Keyrune symbol, and a window showing a featured card's art cropped from its card image.

export type ProductShape = "pack" | "box" | "bundle" | "deck" | "kit";

/** Which package shape suits a product category (MTGJSON's `category`). */
export function shapeForCategory(category: string): ProductShape {
  if (category === "booster_pack") return "pack";
  if (category === "booster_box" || category === "booster_case") return "box";
  if (category.startsWith("bundle")) return "bundle";
  if (category.includes("deck")) return "deck";
  return "kit";
}

const ASPECT: Record<ProductShape, string> = {
  pack: "aspect-[5/8]",
  box: "aspect-[4/3]",
  bundle: "aspect-square",
  deck: "aspect-[3/4]",
  kit: "aspect-[4/5]",
};

/** A stable hue for a set code, so each set keeps its own colors. */
function hueFor(setCode: string): number {
  let hash = 0;
  for (const character of setCode) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

type ProductArtProps = {
  setCode: string;
  setName: string;
  keyruneCode: string;
  /** Big text on the package: "Play Booster", "Bundle". */
  label: string;
  shape: ProductShape;
  /** A card whose art fills the window (cropped from its card image), if any. */
  featuredPrintingId?: string | null;
  artist?: string | null;
};

export function ProductArt(props: ProductArtProps) {
  const hue = hueFor(props.setCode);
  const background = `linear-gradient(160deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 60% 16%))`;
  const isPack = props.shape === "pack";

  return (
    <div
      role="img"
      aria-label={`${props.setName} ${props.label}`}
      className={`relative w-full overflow-hidden text-white shadow-md ${ASPECT[props.shape]} ${isPack ? "rounded-sm" : "rounded-lg"}`}
      style={{ background }}
    >
      {isPack && <CrimpedEdges />}

      {/* The art window: the card's art sits about a third of the way down its image. */}
      <div
        className={`absolute inset-x-[8%] overflow-hidden rounded-md bg-black/30 ring-1 ring-white/30 ${isPack ? "top-[16%] aspect-[4/3]" : "top-[22%] bottom-[30%]"}`}
        style={
          props.featuredPrintingId
            ? {
                backgroundImage: `url(/api/images/${props.featuredPrintingId}/normal/front)`,
                backgroundSize: "118% auto",
                backgroundPosition: "50% 20%",
              }
            : undefined
        }
      />

      <div className="absolute inset-x-[8%] top-[5%] flex items-center gap-2">
        <i
          className={`ss ss-${props.keyruneCode.toLowerCase()} text-2xl drop-shadow`}
          aria-hidden
        />
        <span className="truncate text-[11px] font-semibold tracking-wide uppercase drop-shadow">
          {props.setName}
        </span>
      </div>

      <div className="absolute inset-x-[6%] bottom-[9%] text-center">
        <p className="text-sm leading-tight font-bold drop-shadow sm:text-base">{props.label}</p>
        {props.artist && (
          <p className="mt-1 truncate text-[9px] text-white/70">Art: {props.artist}</p>
        )}
      </div>
    </div>
  );
}

/** The crimped foil seal at the top and bottom of a booster pack. */
function CrimpedEdges() {
  const crimp =
    "repeating-linear-gradient(90deg, rgb(255 255 255 / 0.35) 0 3px, transparent 3px 6px)";
  return (
    <>
      <div className="absolute inset-x-0 top-0 h-[3%]" style={{ background: crimp }} />
      <div className="absolute inset-x-0 bottom-0 h-[3%]" style={{ background: crimp }} />
    </>
  );
}
