import type { Tag } from "@/shared/kernel";
import type { CardFace } from "../types";

/** What the recognizers read: one oracle card's printed faces and Scryfall's `produced_mana`. */
export type CardText = Readonly<{
  oracleId: string;
  faces: ReadonlyArray<Pick<CardFace, "typeLine" | "text">>;
  producedMana: readonly string[];
}>;

/** Whether and how much mana a card adds when tapped (moved unchanged from decks/domain/mana.ts). */
export type TapMana = Readonly<{
  /** A `{T}` ability that adds mana, or Scryfall lists mana the card produces. */
  isSource: boolean;
  /** Mana added by one tap; 0 when it depends on the board (a Temple needs five lands). */
  amount: number;
  /** "Activate only if you control five or more lands". */
  requiresFiveLands: boolean;
}>;

/** Every feature a recognizer fills, by field name. Each field has exactly one recognizer. */
export type CardFeatureFields = Readonly<{
  tapMana: TapMana;
  /** What job the card does in a deck (ramp, draw, removal, …), in `TAGS` order. */
  roleTags: readonly Tag[];
}>;

export type CardFeatures = Readonly<{ featuresVersion: number }> & CardFeatureFields;

/** One recognizer fills the one field it owns, from one card's text. Pure. */
export type Recognizer<Field extends keyof CardFeatureFields> = Readonly<{
  id: string;
  field: Field;
  recognize(card: CardText): CardFeatureFields[Field];
}>;

export type AnyRecognizer = {
  [Field in keyof CardFeatureFields]: Recognizer<Field>;
}[keyof CardFeatureFields];
