import { cardTypes } from "@/shared/kernel";
import type { CardText, Recognizer, TapMana } from "../types";

// Moved unchanged from the tap-mana code that lived in decks/domain/mana.ts.
// It reads the printed text, not text without reminders, exactly as the old code did; reading
// the plain text instead is a later change with a version bump.

const FIVE_LANDS = /activate only if you control five or more lands/i;
const SEVEN_LANDS = /seven or more lands/i;
const TAP_ADDS_MANA = /\{T\}[^.]*Add\s+\{/;
const TAP_ADDS_SYMBOLS = /\{T\}[^.]*Add\s+((?:\{[WUBRGC]\})+)/i;
const MANA_SYMBOLS = new Set(["W", "U", "B", "R", "G", "C"]);

/** How much mana one tap adds, with no board to look at (Urza's lands and doublers need one). */
function manaPerTap(card: CardText, texts: readonly string[], isLand: boolean): number {
  if (texts.some((text) => FIVE_LANDS.test(text))) return 0;
  if (texts.some((text) => SEVEN_LANDS.test(text))) return 1;
  for (const text of texts) {
    const symbols = TAP_ADDS_SYMBOLS.exec(text)?.[1];
    if (symbols !== undefined) return symbols.match(/\{/g)?.length ?? 0;
  }
  const first = card.producedMana[0]?.toUpperCase();
  if (first !== undefined && MANA_SYMBOLS.has(first)) return 1;
  return isLand ? 1 : 0;
}

export const tapMana: Recognizer<"tapMana"> = {
  id: "tap-mana",
  field: "tapMana",
  recognize(card): TapMana {
    const texts = card.faces.map((face) => face.text);
    const typeLine = card.faces.map((face) => face.typeLine).join(" // ");
    return {
      isSource: card.producedMana.length > 0 || texts.some((text) => TAP_ADDS_MANA.test(text)),
      amount: manaPerTap(card, texts, cardTypes(typeLine).isLand),
      requiresFiveLands: texts.some((text) => FIVE_LANDS.test(text)),
    };
  },
};
