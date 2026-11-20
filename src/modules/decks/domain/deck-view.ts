import type { Finish, CardFacts, CardIdentity, Tag, Theme } from "@/shared/kernel";
import type { DeckCount } from "./boards";
import type { Deck } from "./deck";
import type { DeckPlan } from "./deck-profile";
import type { CardRules } from "./rules";
import type { EdhrecSignal } from "./suggest";

// The deck as the builder, the tools and the audits read it (design doc 09, section 8). The query
// that loads it is `queries/decks.ts`; the types live here so the application layer can name them.

/** One deck line with everything the builder shows. */
export type DeckLine = DeckCount &
  CardIdentity &
  Pick<CardFacts, "name" | "typeLine" | "manaValue" | "manaCost" | "text"> &
  Readonly<{
    finish: Finish;
    /** What the deck stores (null when not pinned): for Edit as text (design doc 23). */
    pinnedPrintingId: string | null;
    pinnedFinish: Finish | null;
    /** The deck's own heading for this line ("Ramp"), or null (design doc 34). */
    heading: string | null;
    /** Why this card is in the deck (design doc 41), or null. */
    note: string | null;
    /** Structured role/synergy tags on this line. */
    tags?: readonly string[];
    /** The card's one-line job in this deck, or null (design doc 61). */
    role?: string | null;
    /** Pinned: tools never suggest cutting or replacing it (design doc 61). */
    pinned?: boolean;
    /** Colors of mana it can make, for the deck statistics. */
    producedMana: string[];
    /** What job the card does in a deck (the catalog's card features). */
    roles: readonly Tag[];
    /** What deck the card plays into, and what deck it leads as a commander (card features). */
    themes: readonly Theme[];
    leaderThemes: readonly Theme[];
    /** Rules text face by face (front first), for showing double-faced cards as "front // back". */
    faceTexts?: readonly string[];
    /** The front face's printed stats: "6/5", "Loyalty 4" or "Defense 5"; null when it has none. */
    printedStats?: string | null;
    /** On Wizards' Game Changer list (design doc 31). */
    isGameChanger: boolean;
    /** Latest market price of one copy in its finish, in cents, if known. */
    priceCents: number | null;
    setCode: string;
    collectorNumber: string;
    /** The shown printing's rarity, for the cut ranking's tie-break (design doc 32). */
    rarity: string;
    /** Keyword abilities on any printing of the card ("Flying", "Ward"). */
    keywords: string[];
    /** Scryfall's EDHREC popularity rank (1 = most popular), or null if unranked. */
    edhrecRank: number | null;
    /** Copies counted as owned: game copies, plus real ones when the deck uses them. */
    owned: number;
    /** How many of `owned` are real copies (design doc 16: "3 game · 1 real"). */
    ownedReal: number;
    isBasicLand: boolean;
    /**
     * Your other decks that also use this card, and how many copies each holds (ownership is
     * shared between decks, so they can all count the same copies).
     */
    otherDecks: OtherDeckUse[];
    /** Copies owned that none of your other decks uses (task 42): `owned` minus theirs, at least 0. */
    free: number;
    /** EDHREC inclusion rate and synergy for this deck's commander(s), when synced. */
    edhrec?: EdhrecSignal | null;
  }>;

/** Another of your decks holding a card, on any board (task 42). */
export type OtherDeckUse = Readonly<{
  deckId: number;
  name: string;
  /** Copies of the card in that deck, on every board. */
  quantity: number;
  /** How many of them it can give: all but its commanders, which are never taken. */
  available: number;
}>;

export type DeckView = Readonly<{
  deck: Deck;
  lines: DeckLine[];
  rules: Readonly<Record<string, CardRules>>;
}>;

export type DeckSource = Readonly<{
  id: number;
  url: string;
  title: string;
  usedFor: string;
  addedAt: string;
}>;

/** A deck's stored profile and primer (design doc 61). */
export type StoredDeckProfile = Readonly<{
  deckId: number;
  deckName: string;
  format: string;
  profile: DeckPlan;
  primer: string | null;
}>;
