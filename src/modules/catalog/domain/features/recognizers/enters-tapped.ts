import type { EntersTapped, Recognizer } from "../types";

// Moved unchanged from `tapped` in decks/domain/mana-base.ts: the first sentence that says the
// card enters tapped decides, and a condition in it ("unless", "if", "you may pay") makes it only
// sometimes.
const ENTERS_TAPPED = /enters( the battlefield)? tapped/i;
const CONDITION = /\bunless\b|\bif\b|you may pay/i;

export const entersTapped: Recognizer<"entersTapped"> = {
  id: "enters-tapped",
  field: "entersTapped",
  recognize(card): EntersTapped {
    const text = card.faces.map((face) => face.text).join(" ");
    const sentence = text.split(/(?<=\.)\s+|\n/).find((part) => ENTERS_TAPPED.test(part));
    if (sentence === undefined) return "never";
    return CONDITION.test(sentence) ? "sometimes" : "always";
  },
};
