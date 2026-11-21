// The text colour for each rarity, the same everywhere a card's rarity is shown. Rare uses the
// warning token (gold); each light shade keeps at least 4.5:1 contrast on the page background.
const RARITY_TEXT: Readonly<Record<string, string>> = {
  common: "text-muted",
  uncommon: "text-slate-600 dark:text-slate-400",
  rare: "text-warning-text",
  mythic: "text-orange-700 dark:text-orange-400",
};

/** The class for a rarity's text colour; an unknown rarity reads as common. */
export function rarityTextClass(rarity: string): string {
  return RARITY_TEXT[rarity] ?? RARITY_TEXT.common;
}
