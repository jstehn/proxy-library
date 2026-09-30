import type { BoosterConfig, BoosterSheet, PrintingId } from "@/modules/catalog";
import {
  avoidsRepeats,
  isAnyRaritySheet,
  repeatKey,
  sheetKind,
  type GeneratedPack,
} from "./generate";
import type { FactsLookup } from "./pack";

// Checks a generated pack against the rules its recipe implies (design doc 05, rules 2–4 and 6).
// Used by the property tests and by `pnpm worker check-packs`, which runs it on every real recipe.

/** Everything wrong with this pack, as readable sentences. An empty list means it's fine. */
export function packProblems(
  config: BoosterConfig,
  pack: GeneratedPack,
  facts: FactsLookup,
): string[] {
  const variant = config.variants.at(pack.variantIndex);
  if (variant === undefined) return [`variant ${pack.variantIndex} doesn't exist`];

  const problems: string[] = [];
  const cardsBySheet = new Map<string, PrintingId[]>();
  for (const card of pack.cards) {
    cardsBySheet.set(card.sheet, [...(cardsBySheet.get(card.sheet) ?? []), card.printingId]);

    // Rule 6: a real printing. Rule 4: in a finish it actually has.
    try {
      const printing = facts(card.printingId);
      if (!printing.finishes.includes(card.finish)) {
        problems.push(`${printing.name} (${card.printingId}) doesn't come in ${card.finish}`);
      }
    } catch {
      problems.push(`unknown printing ${card.printingId} on sheet "${card.sheet}"`);
    }
  }

  // Rule 2: exactly the variant's slot counts, and no sheet it doesn't use.
  for (const [sheetName, count] of Object.entries(variant.slots)) {
    const drawn = cardsBySheet.get(sheetName)?.length ?? 0;
    if (drawn !== count) problems.push(`sheet "${sheetName}": ${drawn} cards, expected ${count}`);
  }
  for (const sheetName of cardsBySheet.keys()) {
    if (!(sheetName in variant.slots)) problems.push(`card from unused sheet "${sheetName}"`);
  }

  // Rule 3: no duplicates within a draw, unless the sheet allows them: not the same printing,
  // and not two versions of one card (unless the sheet has too few different cards to avoid it).
  for (const [sheetName, printingIds] of cardsBySheet) {
    const sheet = config.sheets[sheetName];
    if (sheet === undefined || sheetKind(sheet) !== "distinct") continue;
    if (new Set(printingIds).size !== printingIds.length) {
      problems.push(`sheet "${sheetName}" repeated a card`);
      continue;
    }
    const names = cardNames(printingIds, facts);
    const sheetNames = cardNames(
      sheet.cards.map((card) => card.printingId),
      facts,
    );
    if (new Set(names).size < names.length && new Set(sheetNames).size >= names.length) {
      problems.push(`sheet "${sheetName}" gave two versions of one card`);
    }
  }

  // Rule 3b: slots of one rarity never repeat a card another slot gave (in the same finish).
  const sheetsByCard = new Map<string, Set<string>>();
  for (const card of pack.cards) {
    const sheet = config.sheets[card.sheet];
    if (sheet === undefined || !knowsAll(sheet, facts) || isAnyRaritySheet(sheet, facts)) continue;
    if (isBasicOrUnknown(card.printingId, facts)) continue; // basic lands may repeat
    const key = repeatKey(card.printingId, sheet);
    sheetsByCard.set(key, (sheetsByCard.get(key) ?? new Set()).add(card.sheet));
  }
  for (const [key, sheetNames] of sheetsByCard) {
    const names = [...sheetNames];
    const strict = names.some((name) => avoidsRepeats(config.sheets[name], facts));
    if (names.length > 1 && strict) {
      problems.push(`${key.split("/")[0]} came from both "${names.sort().join('" and "')}"`);
    }
  }
  return problems;
}

/** Whether every card on the sheet is a known printing (unknown ones are reported above). */
function knowsAll(sheet: BoosterSheet, facts: FactsLookup): boolean {
  try {
    for (const card of sheet.cards) facts(card.printingId);
    return true;
  } catch {
    return false;
  }
}

/** Basic lands may repeat; an unknown printing is already reported by rule 6. */
function isBasicOrUnknown(printingId: PrintingId, facts: FactsLookup): boolean {
  try {
    return facts(printingId).isBasicLand;
  } catch {
    return true;
  }
}

/** The card names of these printings (basic lands each count as their own; unknown ones too). */
function cardNames(printingIds: readonly PrintingId[], facts: FactsLookup): string[] {
  return printingIds.map((printingId) => {
    try {
      const printing = facts(printingId);
      return printing.isBasicLand ? `basic:${printingId}` : printing.name;
    } catch {
      return `unknown:${printingId}`;
    }
  });
}
