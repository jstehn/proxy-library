import type { Recognizer } from "../types";

// Moved unchanged from the land scoring in decks/domain/mana-base.ts.
const GIVES_OPPONENT_SOMETHING =
  /\b(?:target|an|each)\s+opponent\b[^.]*(?:creates?|draws?|gains?|puts?|adds?|searches?)/i;

export const helpsOpponents: Recognizer<"helpsOpponents"> = {
  id: "helps-opponents",
  field: "helpsOpponents",
  recognize(card) {
    return GIVES_OPPONENT_SOMETHING.test(card.faces.map((face) => face.text).join(" "));
  },
};
