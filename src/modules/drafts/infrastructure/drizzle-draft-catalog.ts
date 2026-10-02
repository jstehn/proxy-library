import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { PrintingId, type Color, type SetCode } from "@/modules/catalog";
import { boosterConfigs, cardSets } from "@/modules/catalog/infrastructure/schema";
import { packMsrp } from "@/modules/store";
import type { DbExecutor } from "@/shared/db";
import { Cents } from "@/shared/kernel";
import type { DraftCatalog } from "../application/ports";
import type { DraftCardFacts } from "../domain/auto-pick";
import { DRAFTABLE_BOOSTER_TYPES } from "../domain/style";

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
const RaritySchema = z.enum(["common", "uncommon", "rare", "mythic", "special", "bonus"]);

const BASIC_COLORS: Readonly<Record<string, Color>> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/** Only known colors survive (Scryfall's produced_mana also has "C" for colorless). */
const colorsOf = (values: readonly string[]): Color[] =>
  values.flatMap((value) => {
    const parsed = ColorSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });

export function drizzleDraftCatalog(db: DbExecutor): DraftCatalog {
  async function draftable(setCode: SetCode, boosterType: string) {
    if (!DRAFTABLE_BOOSTER_TYPES.includes(boosterType)) return null;
    const [row] = await db
      .select({ setName: cardSets.name })
      .from(boosterConfigs)
      .innerJoin(cardSets, eq(cardSets.code, boosterConfigs.setCode))
      .where(
        and(
          eq(boosterConfigs.setCode, setCode),
          eq(boosterConfigs.boosterType, boosterType),
          eq(cardSets.isEnabled, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function setName(setCode: SetCode): Promise<string> {
    const [row] = await db
      .select({ name: cardSets.name })
      .from(cardSets)
      .where(eq(cardSets.code, setCode));
    return row?.name ?? setCode;
  }

  async function packPrice(setCode: SetCode, boosterType: string): Promise<Cents | null> {
    return packMsrp(db, setCode, boosterType);
  }

  async function cardFacts(printingIds: readonly PrintingId[]) {
    const facts = new Map<PrintingId, DraftCardFacts>();
    if (printingIds.length === 0) return facts;
    const rows = await db.execute<{
      id: string;
      name: string;
      rarity: string;
      colors: string[];
      mana_cost: string | null;
      mana_value: number;
      type_line: string;
      produced_mana: string[];
      price: number | null;
    }>(sql`
      select p.id, p.name, p.rarity, p.colors, p.mana_cost, p.mana_value, p.type_line,
             p.produced_mana,
             -- The newest price, nonfoil first: auto-pick uses it only as a hint.
             (select s.usd_cents
                from price_snapshots s
               where s.printing_id = p.id
               order by (s.finish = 'nonfoil') desc, s.day desc
               limit 1) as price
        from printings p
       where p.id = any(${sql.param([...printingIds])}::text[])
    `);
    for (const row of rows.rows) {
      const rarity = RaritySchema.safeParse(row.rarity);
      facts.set(PrintingId.of(row.id), {
        name: row.name,
        rarity: rarity.success ? rarity.data : "common",
        colors: colorsOf(row.colors),
        manaCost: row.mana_cost,
        manaValue: Number(row.mana_value),
        typeLine: row.type_line,
        producedMana: colorsOf(row.produced_mana),
        marketPrice: row.price === null ? null : Cents.of(Number(row.price)),
      });
    }
    return facts;
  }

  async function basicLands(setCode: SetCode): Promise<Map<Color, PrintingId>> {
    const rows = await db.execute<{ name: string; id: string }>(sql`
      select distinct on (p.name) p.name, p.id
        from printings p
        join card_sets s on s.code = p.set_code
       where p.name in ('Plains', 'Island', 'Swamp', 'Mountain', 'Forest')
         and p.type_line ~ '^Basic\\y.*\\yLand\\y'
       -- This set's own basics first, then plain-frame ones from the newest set.
       order by p.name, (p.set_code = ${setCode}) desc, p.is_full_art, s.release_date desc, p.id
    `);
    const lands = new Map<Color, PrintingId>();
    for (const row of rows.rows) {
      const color = BASIC_COLORS[row.name];
      if (color !== undefined) lands.set(color, PrintingId.of(row.id));
    }
    return lands;
  }

  return { draftable, setName, packPrice, cardFacts, basicLands };
}
