import { MANA_SYMBOLS, type ManaSymbol } from "@/shared/kernel";
import { costSymbols } from "./mana-symbols";

// The one mana-payment engine (P15): reading a printed cost and asking whether mana sources can
// pay it. Castability, the cast-by-turn check and the deck profile's cost floor all use it.

/** One coloured requirement of a cost, with every kind of mana that pays it: {G} is ["G"], {B/G} is ["B", "G"]. */
export type Pip = readonly ManaSymbol[];

/** What a mana source gives: one mana of any one of these colours ("C" for colourless). */
export type ManaSource = readonly string[];

export type ParsedCost = Readonly<{
  /** Coloured and colourless symbols, hybrid ones with each colour that pays them; {2/B} needs its B. */
  pips: readonly Pip[];
  /** The colours of Phyrexian symbols: payable with 2 life, so they never block a cast. */
  phyrexian: readonly ManaSymbol[];
  /** Generic mana, the numbers in the cost. `{X}` counts as 0. */
  generic: number;
}>;

export function isManaSymbol(part: string): part is ManaSymbol {
  return (MANA_SYMBOLS as readonly string[]).includes(part);
}

/** Reads a printed cost such as `{1}{U/B}{G/P}`. */
export function parseCost(manaCost: string | null | undefined): ParsedCost {
  const pips: Pip[] = [];
  const phyrexian: ManaSymbol[] = [];
  let generic = 0;
  for (const symbol of costSymbols(manaCost ?? null)) {
    const parts = symbol.toUpperCase().split("/");
    const colors = parts.filter(isManaSymbol);
    if (/^\d+$/.test(symbol)) generic += Number(symbol);
    else if (parts.includes("P")) {
      if (colors.length > 0) phyrexian.push(colors[0]);
      else generic += 1;
    } else if (colors.length > 0) pips.push(colors);
  }
  return { pips, phyrexian, generic };
}

/**
 * The first pip the sources cannot pay, or null when they all can: each source pays one pip with
 * one of its colours, matched by augmenting paths (a small bipartite matching: a cost has a
 * handful of pips). Single-colour pips go first, and sources with the fewest colours are used
 * first, so a dual land is left for the hybrid pip that needs it.
 */
export function firstUnpaidPip(pips: readonly Pip[], sources: readonly ManaSource[]): Pip | null {
  const ordered = [...sources].sort((a, b) => a.length - b.length);
  const sortedPips = [...pips].sort((a, b) => a.length - b.length);
  const pipOfSource: number[] = ordered.map(() => -1);
  function assign(pip: number, seen: boolean[]): boolean {
    for (let source = 0; source < ordered.length; source++) {
      if (seen[source] || !sortedPips[pip].some((color) => ordered[source].includes(color))) {
        continue;
      }
      seen[source] = true;
      if (pipOfSource[source] === -1 || assign(pipOfSource[source], seen)) {
        pipOfSource[source] = pip;
        return true;
      }
    }
    return false;
  }
  return (
    sortedPips.find(
      (_, pip) =>
        !assign(
          pip,
          ordered.map(() => false),
        ),
    ) ?? null
  );
}

/** Whether the sources pay every pip and there are at least `totalMana` of them (generic mana included). */
export function canPay(
  pips: readonly Pip[],
  sources: readonly ManaSource[],
  totalMana = 0,
): boolean {
  return sources.length >= totalMana && firstUnpaidPip(pips, sources) === null;
}
