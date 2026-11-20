import fixtureFile from "./cards.json";

// Real Oracle text for the recognizer tests (cards.json next to this file). Offline.

/** A card as the recognizers read it (the shape of the catalog's `CardText`). */
export type FixtureCard = Readonly<{
  oracleId: string;
  name: string;
  producedMana: readonly string[];
  faces: ReadonlyArray<Readonly<{ typeLine: string; text: string }>>;
}>;

/** Every fixture card. */
export function allFixtureCards(): readonly FixtureCard[] {
  return fixtureFile.map((card) => ({ ...card, oracleId: card.name }));
}

/** One fixture card by name. */
export function fixtureCard(name: string): FixtureCard {
  const found = allFixtureCards().find((card) => card.name === name);
  if (found === undefined) throw new Error(`no fixture card named ${name}`);
  return found;
}
