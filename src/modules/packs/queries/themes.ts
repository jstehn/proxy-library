import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { boosterConfigs } from "@/modules/catalog/infrastructure/schema";
import { packTheme, type ThemeRecipe } from "../domain/theme";

// The themes of opened Jumpstart packs, for the Opened page (task 40, ADR 0006).

/** An opened pack: which recipe it came from and which of its variants it rolled. */
export type OpenedPackKey = Readonly<{
  itemId: number;
  setCode: string | null;
  boosterType: string | null;
  variantIndex: number | null;
}>;

/** Each Jumpstart pack's theme ("Angels"), by item id. Other packs aren't in the map. */
export async function packThemes(
  db: DbExecutor,
  packs: readonly OpenedPackKey[],
): Promise<Map<number, string>> {
  const jumpstart = packs.filter((pack) => pack.boosterType === "jumpstart");
  const setCodes = [...new Set(jumpstart.flatMap((pack) => pack.setCode ?? []))];
  if (setCodes.length === 0) return new Map();

  const rows = await db
    .select({
      setCode: boosterConfigs.setCode,
      variants: boosterConfigs.variants,
      sheets: boosterConfigs.sheets,
    })
    .from(boosterConfigs)
    .where(
      and(eq(boosterConfigs.boosterType, "jumpstart"), inArray(boosterConfigs.setCode, setCodes)),
    );
  const recipes = new Map<string, ThemeRecipe>();
  for (const row of rows) {
    // Written by the catalog sync as a BoosterConfig's variants and sheets, so the shape is known.
    const recipe = {
      boosterType: "jumpstart",
      variants: row.variants,
      sheets: row.sheets,
    } as ThemeRecipe;
    recipes.set(row.setCode, recipe);
  }

  const themes = new Map<number, string>();
  for (const pack of jumpstart) {
    const recipe = pack.setCode === null ? undefined : recipes.get(pack.setCode);
    if (recipe === undefined || pack.variantIndex === null) continue;
    const theme = packTheme(recipe, pack.variantIndex);
    if (theme !== null) themes.set(pack.itemId, theme);
  }
  return themes;
}
