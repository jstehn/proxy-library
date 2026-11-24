import { sql } from "drizzle-orm";
import type { BoosterSheet, SealedContent } from "@/modules/catalog";
import { type DbExecutor, newestDayPrices } from "@/shared/db";
import { assertNever } from "@/shared/kernel";
import type { Finish } from "@/shared/mtg";

type ProductDeckCard = Readonly<{
  printingId: string;
  count: number;
  finish: Finish;
  board: "main" | "side" | "commander";
}>;

type ProductPackContents = Readonly<{
  setCode: string;
  boosterType: string;
  count: number;
  cardsPerPack: number | null;
  rarityAverages: ReadonlyArray<{ label: string; average: number }>;
  chasePrintingIds: readonly string[];
}>;

type ProductDeckContents = Readonly<{
  setCode: string;
  name: string;
  type: string;
  cards: readonly ProductDeckCard[];
}>;

type ProductLooseCard = Readonly<{
  printingId: string;
  finish: Finish;
  count: number;
}>;

type RawProductContents = Readonly<{
  productId: string;
  productName: string;
  packs: readonly ProductPackContents[];
  decks: readonly ProductDeckContents[];
  cards: readonly ProductLooseCard[];
  extras: readonly string[];
  variableNotes: readonly string[];
  wpnDescription: string | null;
  wpnContents: ReadonlyArray<{ depth: number; text: string }>;
}>;

type BoosterVariant = { weight: number; slots: Record<string, number> };

function formatBoosterSlotRarity(rarity: string): string {
  switch (rarity) {
    case "mythic":
      return "Mythic";
    case "rare":
      return "Rare";
    case "uncommon":
      return "Uncommon";
    case "common":
      return "Common";
    case "special":
    case "bonus":
      return "Special / Bonus";
    default:
      return rarity;
  }
}

/**
 * Resolves a sealed product's full structured contents (decks, packs with expected rarity
 * breakdowns & top chase cards, guaranteed loose cards, extras, and WPN text).
 */
export async function productContents(
  db: DbExecutor,
  productId: string,
): Promise<RawProductContents | null> {
  const [root] = (
    await db.execute<{
      id: string;
      name: string;
      contents: SealedContent[];
      description: string | null;
      wpn_contents: Array<{ depth: number; text: string }> | null;
    }>(sql`
      select sp.id, sp.name, sp.contents, w.description, w.contents as wpn_contents
        from sealed_products sp
        left join product_wpn_links l on l.product_id = sp.id
        left join wpn_products w on w.set_code = l.wpn_set_code and w.name = l.wpn_name
       where sp.id = ${productId}
    `)
  ).rows;
  if (root === undefined) return null;

  // Load any nested sealed products iteratively (up to depth 4).
  const productsById = new Map<string, { name: string; contents: SealedContent[] }>();
  productsById.set(root.id, { name: root.name, contents: root.contents });

  let frontier = collectNestedIds(root.contents);
  for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
    const missing = frontier.filter((id) => !productsById.has(id));
    if (missing.length === 0) break;
    const rows = await db.execute<{ id: string; name: string; contents: SealedContent[] }>(sql`
      select id, name, contents
        from sealed_products
       where id = any(${sql.param(missing)}::text[])
    `);
    const next: string[] = [];
    for (const row of rows.rows) {
      productsById.set(row.id, { name: row.name, contents: row.contents });
      next.push(...collectNestedIds(row.contents));
    }
    frontier = next;
  }

  // Flatten the contents tree.
  const packCounts = new Map<string, { setCode: string; boosterType: string; count: number }>();
  const deckKeys = new Map<string, { setCode: string; deckName: string }>();
  const cardCounts = new Map<string, { printingId: string; finish: Finish; count: number }>();
  const extras: string[] = [];
  const variableNotes: string[] = [];

  function walk(contents: readonly SealedContent[], multiplier: number, depth: number) {
    if (depth > 5) return;
    for (const item of contents) {
      switch (item.kind) {
        case "pack": {
          const key = `${item.setCode}/${item.boosterType}`;
          const prev = packCounts.get(key);
          if (prev) prev.count += multiplier;
          else
            packCounts.set(key, {
              setCode: item.setCode,
              boosterType: item.boosterType,
              count: multiplier,
            });
          break;
        }
        case "sealed": {
          const nested = productsById.get(item.productId);
          if (nested) {
            walk(nested.contents, multiplier * item.count, depth + 1);
          } else {
            extras.push(`${item.count * multiplier}× nested product`);
          }
          break;
        }
        case "deck": {
          const key = `${item.setCode}/${item.deckName}`;
          if (!deckKeys.has(key)) {
            deckKeys.set(key, { setCode: item.setCode, deckName: item.deckName });
          }
          break;
        }
        case "card": {
          const key = `${item.printingId}/${item.finish}`;
          const prev = cardCounts.get(key);
          if (prev) prev.count += multiplier;
          else
            cardCounts.set(key, {
              printingId: item.printingId,
              finish: item.finish,
              count: multiplier,
            });
          break;
        }
        case "other":
          extras.push(multiplier > 1 ? `${multiplier}× ${item.name}` : item.name);
          break;
        case "variable":
          if (item.options.length > 0) {
            variableNotes.push(
              `Includes 1 randomly chosen variant out of ${item.options.length} possible configurations.`,
            );
          }
          break;
        default:
          return assertNever(item);
      }
    }
  }

  walk(root.contents, 1, 0);

  // Hydrate referenced deck lists.
  const decks: ProductDeckContents[] = [];
  for (const { setCode, deckName } of deckKeys.values()) {
    const [row] = (
      await db.execute<{
        set_code: string;
        name: string;
        type: string;
        cards: ProductDeckCard[];
      }>(sql`
        select set_code, name, type, cards
          from deck_lists
         where set_code = ${setCode} and name = ${deckName}
      `)
    ).rows;
    if (row) {
      decks.push({
        setCode: row.set_code,
        name: row.name,
        type: row.type,
        cards: row.cards,
      });
    }
  }

  // Hydrate referenced booster pack odds + top chase cards.
  const packs: ProductPackContents[] = [];
  for (const entry of packCounts.values()) {
    const summary = await summarizeBooster(db, entry.setCode, entry.boosterType, entry.count);
    packs.push(summary);
  }

  return {
    productId: root.id,
    productName: root.name,
    packs,
    decks,
    cards: [...cardCounts.values()],
    extras,
    variableNotes,
    wpnDescription: root.description,
    wpnContents: root.wpn_contents ?? [],
  };
}

function collectNestedIds(contents: readonly SealedContent[]): string[] {
  const ids: string[] = [];
  for (const item of contents) {
    if (item.kind === "sealed") ids.push(item.productId);
  }
  return ids;
}

async function summarizeBooster(
  db: DbExecutor,
  setCode: string,
  boosterType: string,
  count: number,
): Promise<ProductPackContents> {
  const [config] = (
    await db.execute<{
      variants: BoosterVariant[];
      sheets: Record<string, BoosterSheet>;
    }>(sql`
      select variants, sheets
        from booster_configs
       where set_code = ${setCode} and booster_type = ${boosterType}
    `)
  ).rows;

  if (!config || config.variants.length === 0) {
    return {
      setCode,
      boosterType,
      count,
      cardsPerPack: null,
      rarityAverages: [],
      chasePrintingIds: [],
    };
  }

  const totalVariantWeight = config.variants.reduce((sum, v) => sum + v.weight, 0);
  let cardsPerPack = 0;
  for (const variant of config.variants) {
    const share = variant.weight / totalVariantWeight;
    const slotTotal = Object.values(variant.slots).reduce((sum, n) => sum + n, 0);
    cardsPerPack += share * slotTotal;
  }

  // Collect every printing id across the booster's sheets.
  const allIds = new Set<string>();
  for (const sheet of Object.values(config.sheets)) {
    for (const card of sheet.cards) allIds.add(card.printingId);
  }
  const idList = [...allIds];

  // Fetch rarities and top chase cards in parallel.
  const [rarityRows, chaseRows] = await Promise.all([
    idList.length === 0
      ? Promise.resolve({ rows: [] as Array<{ id: string; rarity: string }> })
      : db.execute<{ id: string; rarity: string }>(sql`
          select id, rarity from printings where id = any(${sql.param(idList)}::text[])
        `),
    idList.length === 0
      ? Promise.resolve({ rows: [] as Array<{ printing_id: string }> })
      : db.execute<{ printing_id: string }>(sql`
          select s.printing_id
            from ${newestDayPrices()} s
           where s.printing_id = any(${sql.param(idList)}::text[])
             and s.finish = 'nonfoil'
           order by s.usd_cents desc
           limit 8
        `),
  ]);

  const rarityById = new Map(rarityRows.rows.map((r) => [r.id, r.rarity]));
  const expectedByLabel = new Map<string, number>();

  for (const variant of config.variants) {
    const share = variant.weight / totalVariantWeight;
    for (const [sheetName, slotCount] of Object.entries(variant.slots)) {
      const sheet = config.sheets[sheetName];
      if (!sheet || sheet.cards.length === 0) continue;
      const totalWeight = sheet.cards.reduce((sum, c) => sum + c.weight, 0);
      if (totalWeight <= 0) continue;

      if (sheet.isFoil) {
        expectedByLabel.set("Foil", (expectedByLabel.get("Foil") ?? 0) + share * slotCount);
      }

      for (const card of sheet.cards) {
        const rarity = rarityById.get(card.printingId);
        if (!rarity) continue;
        const label = formatBoosterSlotRarity(rarity);
        const avg = share * slotCount * (card.weight / totalWeight);
        expectedByLabel.set(label, (expectedByLabel.get(label) ?? 0) + avg);
      }
    }
  }

  const ORDER = ["Mythic", "Rare", "Special / Bonus", "Uncommon", "Common", "Foil"];
  const rarityAverages = ORDER.filter((label) => (expectedByLabel.get(label) ?? 0) >= 0.01).map(
    (label) => ({
      label,
      average: Math.round((expectedByLabel.get(label) ?? 0) * 100) / 100,
    }),
  );

  return {
    setCode,
    boosterType,
    count,
    cardsPerPack: Math.round(cardsPerPack),
    rarityAverages,
    chasePrintingIds: chaseRows.rows.map((r) => r.printing_id),
  };
}
