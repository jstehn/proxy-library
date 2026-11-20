// The card fields many modules read, declared once (refactor P26). A module that needs some of them
// writes `Pick<CardFacts, "name" | "typeLine">` and adds its own fields with `&`. Pure types only.
//
// Two groups, small and named in full words:
//   CardFacts     what is printed on a card (name, type line, cost, rules text, mana it makes).
//   CardIdentity  which card and which printing of it.
// A deck line is `CardIdentity`, `CardFacts` and `DeckCount` (in decks/domain/boards.ts) put together.

/** What is printed on a card, for every face joined as the catalog joins them. */
export type CardFacts = Readonly<{
  name: string;
  /** "Legendary Creature — Elf Druid"; read it with `cardTypes`, never with a regex. */
  typeLine: string;
  /** "{2}{W}{W}", or null for a card without a cost (a land). */
  manaCost: string | null;
  manaValue: number;
  /** Rules text of every face, "" if none. */
  text: string;
  /** Colors of mana it can make: "W", "U", "B", "R", "G", "C". */
  producedMana: readonly string[];
}>;

/** Which card (all printings share an oracle id) and which printing of it. */
export type CardIdentity = Readonly<{
  oracleId: string;
  printingId: string;
}>;
