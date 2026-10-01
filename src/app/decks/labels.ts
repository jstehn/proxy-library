import type { DeckProblem, Format } from "@/modules/decks";
import { assertNever } from "@/shared/kernel";

export const FORMAT_LABELS: Record<Format, string> = {
  casual: "Casual (no rules)",
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
  commander: "Commander",
};

/** A deck problem in plain words. */
export function problemText(problem: DeckProblem): string {
  switch (problem.kind) {
    case "Short":
      return `You own ${problem.owned} ${problem.name}, and the deck uses ${problem.needed}.`;
    case "TooFewCards":
      return `The main deck has ${problem.count} cards; it needs at least ${problem.minimum}.`;
    case "WrongSize":
      return `The deck has ${problem.count} cards; it needs exactly ${problem.required}.`;
    case "SideboardTooBig":
      return `The sideboard has ${problem.count} cards; the most is ${problem.maximum}.`;
    case "TooManyCopies":
      return `${problem.count} copies of ${problem.name}; the most allowed is ${problem.maximum}.`;
    case "NotLegal":
      return `${problem.name} is ${problem.status.replace("_", " ")} in this format.`;
    case "CommanderMissing":
      return "Choose a commander (put a card on the commander board).";
    case "TooManyCommanders":
      return `${problem.count} commanders; the most is 2.`;
    case "CommanderInvalid":
      return `${problem.name} can't be a commander (a commander is a legendary creature, a legendary Vehicle or Spacecraft with power and toughness, or says it can be your commander).`;
    case "OutsideColorIdentity":
      return `${problem.name} is outside your commander's colors.`;
    default:
      return assertNever(problem);
  }
}
