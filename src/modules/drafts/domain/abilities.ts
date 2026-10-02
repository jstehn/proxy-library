import type { Color } from "@/modules/catalog";

// Cards that do something during the draft (design doc 18, section 3), as data: the pick engine
// asks this table what a card does, instead of naming cards in code (the Strategy idea, like
// DRAFT_STYLES). Keyed by card name, so reprints (The List) work too.

/** Where a card is, once drafted. */
export type CardRef = Readonly<{ packNumber: number; slot: number }>;

export const sameCard = (a: CardRef, b: CardRef) =>
  a.packNumber === b.packNumber && a.slot === b.slot;

export type DraftAbility =
  /** Note how many cards you've drafted this round, including it (Lurking Automaton, …). */
  | Readonly<{ kind: "countNote" }>
  /** Note the player who passed it to you (Cogwork Tracker). */
  | Readonly<{ kind: "passerNote" }>
  /** Right neighbor, you, then left neighbor each choose a color (Paliano, Regicide). */
  | Readonly<{ kind: "colorsNote" }>
  /** Reveal the next card you draft and note its name (Aether Searcher). */
  | Readonly<{ kind: "nextCardName" }>
  /** Look at the next card drafted from this pack (Cogwork Spy). */
  | Readonly<{ kind: "spy" }>
  /** Guess the next card drafted from this pack (Spire Phantasm). */
  | Readonly<{ kind: "guess" }>
  /** After drafting it, you may add a booster pack (Lore Seeker). */
  | Readonly<{ kind: "addPack" }>
  /** As you draft a card, draft one more from that pack (Librarian: then it goes into the pack;
   * Operative: then skip your next pack). */
  | Readonly<{ kind: "extraCard"; then: "intoPack" | "skipPack" }>
  /** Instead of drafting a card, draft the whole pack, then nothing more this round (Agent). */
  | Readonly<{ kind: "wholePack" }>
  /** As you draft a card, you may remove it from the draft (Grinder face down, Animus face up). */
  | Readonly<{ kind: "remove"; faceUp: boolean }>
  /** As you draft a (creature) card, reveal it and note its name or creature types. */
  | Readonly<{ kind: "noteDrafted"; what: "name" | "types"; creaturesOnly: boolean }>
  /** While face up you can't look at packs and draft at random, three times (Archdemon). */
  | Readonly<{ kind: "random"; times: number }>
  /** The last card of every pack is passed to you (Canal Dredger). */
  | Readonly<{ kind: "lastCards" }>
  /** Any time: look at an unopened pack, or one nobody is looking at (Whispergear Sneak). */
  | Readonly<{ kind: "peekPack" }>
  /** Any time: see the next card a player of your choice drafts (Illusionary Informant). */
  | Readonly<{ kind: "watchPlayer" }>
  /** Right after the draft, offer a card from your pool in exchange (Deal Broker). */
  | Readonly<{ kind: "dealAfter" }>;

export type CardAbility = Readonly<{
  /** "Draft this card face up." */
  faceUp: boolean;
  /** "Reveal this card as you draft it." */
  reveal: boolean;
  ability: DraftAbility;
}>;

const faceUp = (ability: DraftAbility): CardAbility => ({ faceUp: true, reveal: false, ability });
const revealed = (ability: DraftAbility): CardAbility => ({ faceUp: false, reveal: true, ability });

export const DRAFT_ABILITIES: Readonly<Record<string, CardAbility>> = {
  // Conspiracy (CNS)
  "Aether Searcher": revealed({ kind: "nextCardName" }),
  "Agent of Acquisitions": faceUp({ kind: "wholePack" }),
  "Canal Dredger": faceUp({ kind: "lastCards" }),
  "Cogwork Grinder": faceUp({ kind: "remove", faceUp: false }),
  "Cogwork Librarian": faceUp({ kind: "extraCard", then: "intoPack" }),
  "Cogwork Spy": revealed({ kind: "spy" }),
  "Cogwork Tracker": revealed({ kind: "passerNote" }),
  "Deal Broker": faceUp({ kind: "dealAfter" }),
  "Lore Seeker": revealed({ kind: "addPack" }),
  "Lurking Automaton": revealed({ kind: "countNote" }),
  "Paliano, the High City": revealed({ kind: "colorsNote" }),
  "Whispergear Sneak": faceUp({ kind: "peekPack" }),
  // Conspiracy: Take the Crown (CN2)
  "Animus of Predation": faceUp({ kind: "remove", faceUp: true }),
  "Archdemon of Paliano": faceUp({ kind: "random", times: 3 }),
  "Custodi Peacekeeper": revealed({ kind: "countNote" }),
  "Garbage Fire": revealed({ kind: "countNote" }),
  "Illusionary Informant": faceUp({ kind: "watchPlayer" }),
  "Leovold's Operative": faceUp({ kind: "extraCard", then: "skipPack" }),
  "Noble Banneret": faceUp({ kind: "noteDrafted", what: "name", creaturesOnly: true }),
  "Paliano Vanguard": faceUp({ kind: "noteDrafted", what: "types", creaturesOnly: true }),
  "Pyretic Hunter": revealed({ kind: "countNote" }),
  Regicide: revealed({ kind: "colorsNote" }),
  "Smuggler Captain": faceUp({ kind: "noteDrafted", what: "name", creaturesOnly: false }),
  "Spire Phantasm": revealed({ kind: "guess" }),
};

export function abilityOf(name: string | undefined): CardAbility | null {
  return name === undefined ? null : (DRAFT_ABILITIES[name] ?? null);
}

/** What was noted for a drafted card (CR 905.2b): public for the rest of the draft and the game. */
export type Note =
  | Readonly<{ kind: "count"; value: number }>
  | Readonly<{ kind: "passedBy"; seat: number | null }>
  /** Colors chosen so far, by `choosers` in order (right neighbor, drafter, left neighbor). */
  | Readonly<{ kind: "colors"; choosers: readonly number[]; colors: readonly Color[] }>
  | Readonly<{ kind: "name"; name: string; from: CardRef }>
  | Readonly<{ kind: "types"; types: readonly string[]; from: CardRef }>
  /** Spire Phantasm: the guess, and the card that was drafted next (null until then). */
  | Readonly<{ kind: "guess"; guess: string | null; actual: string | null }>
  /** Archdemon of Paliano: cards drafted at random while it was face up. */
  | Readonly<{ kind: "randomDrafted"; count: number }>;

export const COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

/** A Spire Phantasm guess is right when the names match, ignoring case and spaces at the ends. */
export function guessedRight(note: Extract<Note, { kind: "guess" }>): boolean {
  if (note.guess === null || note.actual === null) return false;
  return note.guess.trim().toLowerCase() === note.actual.trim().toLowerCase();
}

/** "Creature — Human Knight" → ["Human", "Knight"] (Paliano Vanguard notes creature types). */
export function creatureTypes(typeLine: string): string[] {
  const [front] = typeLine.split(" // ");
  const [types, subtypes] = front.split(" — ");
  if (subtypes === undefined || !/\bCreature\b/.test(types)) return [];
  return subtypes.split(/\s+/).filter((word) => word.length > 0);
}

export const isCreatureLine = (typeLine: string) => /\bCreature\b/.test(typeLine);
export const isConspiracyLine = (typeLine: string) => /\bConspiracy\b/.test(typeLine);
