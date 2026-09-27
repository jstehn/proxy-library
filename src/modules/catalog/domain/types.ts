import type { Brand, Cents } from "@/shared/kernel";

// The catalog's own vocabulary (design doc 04, section 3). External data is translated into
// these types by the anti-corruption layer in ../infrastructure; nothing else sees raw JSON.

/** A set code, always uppercase, e.g. "BLB". */
export type SetCode = Brand<string, "SetCode">;
export const SetCode = {
  of(raw: string): SetCode {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(code)) throw new RangeError(`not a set code: ${raw}`);
    return code as SetCode;
  },
};

/** One version of a card; MTGJSON's `uuid`. */
export type PrintingId = Brand<string, "PrintingId">;
export const PrintingId = {
  of(raw: string): PrintingId {
    if (raw.length === 0) throw new RangeError("PrintingId must be non-empty");
    return raw as PrintingId;
  },
};

export type SealedProductId = Brand<string, "SealedProductId">;
export const SealedProductId = {
  of(raw: string): SealedProductId {
    if (raw.length === 0) throw new RangeError("SealedProductId must be non-empty");
    return raw as SealedProductId;
  },
};

export type Finish = "nonfoil" | "foil" | "etched";
export const FINISHES: readonly Finish[] = ["nonfoil", "foil", "etched"];

export type Rarity = "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";
export type Color = "W" | "U" | "B" | "R" | "G";

export type CardSetInfo = Readonly<{
  code: SetCode;
  name: string;
  releaseDate: string; // "2024-08-02"
  type: string; // "expansion", "core", "commander", "masterpiece", …
  keyruneCode: string;
  parentCode: SetCode | null;
}>;

export type Treatments = Readonly<{
  borderColor: string; // "black", "borderless", …
  frameVersion: string;
  frameEffects: readonly string[]; // "showcase", "extendedart", …
  promoTypes: readonly string[]; // "surgefoil", "serialized", "bundle", …
  isFullArt: boolean;
}>;

/** One face of a card: what's printed on it. Most cards have one; double-faced cards have two. */
export type CardFace = Readonly<{
  name: string;
  manaCost: string | null; // "{2}{W}{W}"
  typeLine: string;
  text: string; // rules text, "" if none; "\n" between paragraphs
  power: string | null; // strings, because of values like "*" or "1+*"
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
}>;

export type Printing = Readonly<{
  id: PrintingId;
  setCode: SetCode;
  collectorNumber: string;
  name: string;
  oracleId: string;
  scryfallId: string;
  rarity: Rarity;
  colors: readonly Color[];
  colorIdentity: readonly Color[];
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  layout: string;
  finishes: readonly Finish[];
  treatments: Treatments;
  variantLabel: string; // "" for the regular version, "Borderless · Showcase" otherwise
  faces: readonly CardFace[];
  artist: string | null;
}>;

export type BoosterSheet = Readonly<{
  cards: ReadonlyArray<Readonly<{ printingId: PrintingId; weight: number }>>;
  isFoil: boolean;
  allowDuplicates: boolean;
  balanceColors: boolean;
  isFixed: boolean;
}>;

/** MTGJSON's recipe for one kind of booster pack (e.g. Bloomburrow "play"). */
export type BoosterConfig = Readonly<{
  setCode: SetCode;
  boosterType: string;
  /** Pack layouts: each picks how many cards to draw from which sheet, chosen by weight. */
  variants: ReadonlyArray<Readonly<{ weight: number; slots: Readonly<Record<string, number>> }>>;
  sheets: Readonly<Record<string, BoosterSheet>>;
  sourceSetCodes: readonly SetCode[];
}>;

/** What a sealed product contains: a tree, because products contain other products. */
export type SealedContent =
  | Readonly<{ kind: "pack"; setCode: SetCode; boosterType: string }>
  | Readonly<{ kind: "sealed"; productId: SealedProductId; count: number }>
  | Readonly<{ kind: "card"; printingId: PrintingId; finish: Finish }>
  | Readonly<{ kind: "deck"; setCode: SetCode; deckName: string }>
  | Readonly<{ kind: "other"; name: string }> // spindowns, storage boxes: listed, no effect
  | Readonly<{ kind: "variable"; options: ReadonlyArray<readonly SealedContent[]> }>;

export type SealedProduct = Readonly<{
  id: SealedProductId;
  setCode: SetCode;
  name: string;
  category: string; // "booster_pack", "booster_box", "bundle", …
  subtype: string | null; // "play", "collector", …
  releaseDate: string | null;
  contents: readonly SealedContent[];
}>;

export type DeckCard = Readonly<{
  printingId: PrintingId;
  count: number;
  finish: Finish;
  board: "main" | "side" | "commander";
}>;

export type DeckList = Readonly<{
  setCode: SetCode;
  name: string;
  type: string; // "Starter Kit", "Commander Deck", "Bundle Land Pack", …
  cards: readonly DeckCard[];
  sourceSetCodes: readonly SetCode[];
}>;

/** Everything one MTGJSON set file contributes, after translation and paper-only filtering. */
export type SetImport = Readonly<{
  set: CardSetInfo;
  version: string; // MTGJSON version, e.g. "5.3.0+20260926"
  printings: readonly Printing[];
  boosters: readonly BoosterConfig[];
  products: readonly SealedProduct[];
  decks: readonly DeckList[];
  /** Sets that sealed products take individual cards from (e.g. promo sets for prerelease kits). */
  productCardSetCodes: readonly SetCode[];
  skipped: SkippedDigital;
}>;

/** What paper-only filtering left out, reported in the sync summary (design doc 04, rule 9). */
export type SkippedDigital = Readonly<{
  printings: number;
  boosterTypes: readonly string[];
  products: readonly string[];
  decks: readonly string[];
}>;

/** One card's daily market prices from Scryfall, per finish (null = no price for that finish). */
export type ScryfallPrices = Readonly<Record<Finish, Cents | null>>;

export type ImageUris = Readonly<{
  front: Readonly<{ small: string; normal: string; large: string }>;
  back: Readonly<{ small: string; normal: string; large: string }> | null; // double-faced cards
}>;

/** The parts of a Scryfall card the catalog uses, after translation. */
export type ScryfallCard = Readonly<{
  scryfallId: string;
  setCode: SetCode;
  setType: string;
  isDigital: boolean;
  language: string;
  isStandardLegal: boolean;
  isBasicLand: boolean;
  prices: ScryfallPrices;
  images: ImageUris | null;
  legalities: Readonly<Record<string, string>>;
}>;

export type PriceSnapshot = Readonly<{
  printingId: PrintingId;
  finish: Finish;
  day: string; // "2026-09-27" (UTC)
  price: Cents;
}>;
