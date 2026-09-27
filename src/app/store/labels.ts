// How sealed product is described in the store.

const CATEGORY_LABELS: Record<string, string> = {
  booster_pack: "Booster packs",
  booster_box: "Booster boxes",
  booster_case: "Cases",
  bundle: "Bundles",
  bundle_case: "Cases",
  limited_aid_tool: "Prerelease and draft kits",
  limited_aid_case: "Cases",
  deck: "Decks",
  deck_box: "Deck boxes",
  multiple_decks: "Deck sets",
  box_set: "Boxed sets",
  subset: "Sets of products",
  kit: "Kits",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll("_", " ");
}

/** "Bloomburrow Play Booster Pack" in set "Bloomburrow" → "Play Booster Pack". */
export function productLabel(productName: string, setName: string): string {
  const withoutSet = productName.startsWith(`${setName} `)
    ? productName.slice(setName.length + 1)
    : productName;
  return withoutSet || productName;
}
