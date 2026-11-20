import type { CardFacts, CardIdentity, Tag } from "@/shared/kernel";
import type { DeckCount } from "../boards";
import { isLand } from "../stats";

/** What the hand engine needs from a deck line. */
export type DrawLine = DeckCount &
  CardIdentity &
  Pick<CardFacts, "name" | "typeLine"> &
  Readonly<{
    manaValue?: number;
    roles?: readonly Tag[];
    producedMana?: readonly string[];
  }>;

/** One copy of a card in the library. */
export type LibraryCard = Readonly<{
  /** Tells copies apart: "oracleId#2". */
  key: string;
  oracleId: string;
  name: string;
  printingId: string;
  isLand: boolean;
  manaValue?: number;
  tags: readonly Tag[];
  /** Colors of mana it makes once in play ("C" for colorless); empty for most spells. */
  producedMana?: readonly string[];
}>;

export const OPENING_HAND = 7;

/** Maximum mana value of a non-land ramp spell counted as castable by turn 3 (design doc 43). */
export const EARLY_RAMP_MAX_MV = 3;

/** The cards you draw from: one entry per copy in the main deck. Commanders start in the
 * command zone, and the sideboard stays out (invariant 5). */
export function library(lines: readonly DrawLine[]): LibraryCard[] {
  return lines
    .filter((line) => line.board === "main")
    .flatMap((line) => {
      const tags = line.roles ?? [];
      return Array.from({ length: line.quantity }, (_, copy) => ({
        key: `${line.oracleId}#${copy + 1}`,
        oracleId: line.oracleId,
        name: line.name,
        printingId: line.printingId,
        isLand: isLand(line.typeLine),
        ...(line.manaValue !== undefined ? { manaValue: line.manaValue } : {}),
        tags,
        ...(line.producedMana !== undefined && line.producedMana.length > 0
          ? { producedMana: line.producedMana }
          : {}),
      }));
    });
}
