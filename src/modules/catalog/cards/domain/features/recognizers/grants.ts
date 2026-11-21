// Grants: the keyword abilities a card gives to other cards ("creatures you control have haste",
// "equipped creature has flying and trample", "target creature gains haste until end of turn").
// A card's own keywords are Scryfall's list (`CardText.keywords`); this is the other direction
// (design doc 66, question 5). The names are Scryfall's keyword names.
import { plainText } from "@/shared/mtg";
import type { CardText, Recognizer } from "../types";

/** Keyword abilities that one card commonly gives another. */
const GRANTABLE = [
  "Blitz",
  "Deathtouch",
  "Defender",
  "Double strike",
  "First strike",
  "Flash",
  "Flying",
  "Haste",
  "Hexproof",
  "Indestructible",
  "Infect",
  "Lifelink",
  "Menace",
  "Persist",
  "Reach",
  "Shroud",
  "Skulk",
  "Trample",
  "Undying",
  "Vigilance",
  "Ward",
  "Wither",
] as const;

/** "have", "has" or "gains" something, but not the card giving itself the ability ("~ has"). */
const GRANT_CLAUSE = /(?<!~ )(?<!\bit )\b(?:have|has|gains?)\b[^.:\n]*/gi;

/** The keyword abilities this card gives to others, in alphabetical order. */
export function grantedKeywords(card: CardText): string[] {
  const names = card.faces.map((face) => face.name);
  const clauses = card.faces.flatMap(
    (face) => plainText(face.text, names).match(GRANT_CLAUSE) ?? [],
  );
  return GRANTABLE.filter((keyword) =>
    clauses.some((clause) => new RegExp(`\\b${keyword}\\b`, "i").test(clause)),
  );
}

export const grants: Recognizer<"grants"> = {
  id: "grants",
  field: "grants",
  recognize: (card) => grantedKeywords(card),
};
