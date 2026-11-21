// What a card view shows on a phone: the image, the text, or both (the image above the text).
// The choice is remembered per device in localStorage, which can be missing or throw (private
// windows, blocked site data), so every read and write is guarded and falls back to the image.

export const CARD_VIEW_MODES = ["image", "text", "both"] as const;
export type CardViewMode = (typeof CARD_VIEW_MODES)[number];

export const DEFAULT_CARD_VIEW_MODE: CardViewMode = "image";
export const CARD_VIEW_STORAGE_KEY = "card-view-mode";

/** The labels of the three modes, for the toggle. */
export const CARD_VIEW_LABELS: Readonly<Record<CardViewMode, string>> = {
  image: "Image",
  text: "Text",
  both: "Both",
};

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

/** A stored value as a mode; anything unknown (or missing) is the default. */
export function parseCardViewMode(raw: unknown): CardViewMode {
  return CARD_VIEW_MODES.find((mode) => mode === raw) ?? DEFAULT_CARD_VIEW_MODE;
}

/** The remembered mode. A missing or throwing storage gives the default. */
export function readCardViewMode(storage: StorageReader | null): CardViewMode {
  try {
    return parseCardViewMode(storage?.getItem(CARD_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_CARD_VIEW_MODE;
  }
}

/** Remembers the mode. A missing or throwing storage is ignored: the choice just isn't kept. */
export function writeCardViewMode(storage: StorageWriter | null, mode: CardViewMode): void {
  try {
    storage?.setItem(CARD_VIEW_STORAGE_KEY, mode);
  } catch {
    // Storage is blocked or full: the choice lasts until the page is closed.
  }
}

/**
 * Which parts show. A card without an image can't show "image", so it shows its text instead.
 */
export function visibleParts(
  mode: CardViewMode,
  hasImage: boolean,
): Readonly<{ image: boolean; text: boolean }> {
  const effective = !hasImage && mode === "image" ? "text" : mode;
  return {
    image: hasImage && effective !== "text",
    text: effective !== "image",
  };
}
