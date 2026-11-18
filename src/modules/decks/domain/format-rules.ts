// Declarative format ruleset registry so simulation and deckbuilding avoid scattered
// `format === "commander"` conditionals.

export type FormatRuleSet = Readonly<{
  id: string;
  freeFirstMulligan: boolean;
  copyLimit: number;
  hasCommandZone: boolean;
  commandZoneTaxPerCast: number;
}>;

const DEFAULT_CONSTRUCTED: FormatRuleSet = {
  id: "constructed",
  freeFirstMulligan: false,
  copyLimit: 4,
  hasCommandZone: false,
  commandZoneTaxPerCast: 0,
};

export const FORMAT_RULES: Readonly<Record<string, FormatRuleSet>> = {
  commander: {
    id: "commander",
    freeFirstMulligan: true,
    copyLimit: 1,
    hasCommandZone: true,
    commandZoneTaxPerCast: 2,
  },
  brawl: {
    id: "brawl",
    freeFirstMulligan: true,
    copyLimit: 1,
    hasCommandZone: true,
    commandZoneTaxPerCast: 2,
  },
  oathbreaker: {
    id: "oathbreaker",
    freeFirstMulligan: true,
    copyLimit: 1,
    hasCommandZone: true,
    commandZoneTaxPerCast: 2,
  },
  standard: { ...DEFAULT_CONSTRUCTED, id: "standard" },
  modern: { ...DEFAULT_CONSTRUCTED, id: "modern" },
  pioneer: { ...DEFAULT_CONSTRUCTED, id: "pioneer" },
  legacy: { ...DEFAULT_CONSTRUCTED, id: "legacy" },
  vintage: { ...DEFAULT_CONSTRUCTED, id: "vintage" },
  pauper: { ...DEFAULT_CONSTRUCTED, id: "pauper" },
  limited: { ...DEFAULT_CONSTRUCTED, id: "limited", copyLimit: Number.POSITIVE_INFINITY },
};

export function getFormatRules(
  format: string,
  overrides?: Readonly<Record<string, FormatRuleSet>>,
): FormatRuleSet {
  const key = format.trim().toLowerCase();
  return overrides?.[key] ?? FORMAT_RULES[key] ?? { ...DEFAULT_CONSTRUCTED, id: key || "unknown" };
}
