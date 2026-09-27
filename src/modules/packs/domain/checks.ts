import type { BoosterConfig, PrintingId } from "@/modules/catalog";
import { sheetKind, type GeneratedPack } from "./generate";
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

  // Rule 3: no duplicates within a draw, unless the sheet allows them.
  for (const [sheetName, printingIds] of cardsBySheet) {
    const sheet = config.sheets[sheetName];
    if (sheet === undefined || sheetKind(sheet) !== "distinct") continue;
    if (new Set(printingIds).size !== printingIds.length) {
      problems.push(`sheet "${sheetName}" repeated a card`);
    }
  }
  return problems;
}
