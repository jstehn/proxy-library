import type { BracketFlag, SignalIO, SignalKind, Tag, Theme } from "@/shared/kernel";
import type { CardFace } from "../types";

/** What the recognizers read: one oracle card's printed faces and Scryfall's `produced_mana`. */
export type CardText = Readonly<{
  oracleId: string;
  faces: ReadonlyArray<Pick<CardFace, "name" | "typeLine" | "text">>;
  producedMana: readonly string[];
  /** Scryfall's keyword list ("Flying", "Ward"). */
  keywords: readonly string[];
  manaValue: number;
}>;

/** One thing a card's text shows, with a card search that finds more like it. */
export type SignalFact = Readonly<{ kind: SignalKind; name: string; followUp: string }>;

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
  /** What deck the card plays into (counters, tokens, …), in `THEMES` order. */
  themes: readonly Theme[];
  /** What deck a commander with this text leads, in `THEMES` order. */
  leaderThemes: readonly Theme[];
  /** Land denial and extra turns, from the text (Game Changers are Scryfall's own list). */
  bracketFlags: readonly Exclude<BracketFlag, "gameChanger">[];
  /** What the card's text mentions, for the deck-level counting in decks (design doc 28). */
  signals: readonly SignalFact[];
  /** The themes the card makes and uses: a Treasure maker makes treasures, a payoff uses them. */
  signalIO: SignalIO;
  /** Each face's rules text without reminder text and with the card's own names as "~". */
  faces: readonly Readonly<{ plainText: string }>[];
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
