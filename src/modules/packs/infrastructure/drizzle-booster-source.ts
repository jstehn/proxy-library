import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { PrintingId, SetCode, type BoosterConfig, type Finish } from "@/modules/catalog";
import { boosterConfigs, cardSets } from "@/modules/catalog/infrastructure/schema";
import type { DbExecutor } from "@/shared/db";
import { Cents } from "@/shared/kernel";
import type { BoosterKey, BoosterSource } from "../application/ports";
import type { PrintingFacts } from "../domain/pack";

// The catalog's tables, read for the pack engine. The recipes were written by our own import,
// but a JSON column is still a boundary: it's checked again here ("parse, don't validate").

const SheetSchema = z.object({
  cards: z.array(
    z.object({
      printingId: z.string().min(1).transform(PrintingId.of),
      weight: z.number().int().positive(),
    }),
  ),
  isFoil: z.boolean(),
  allowDuplicates: z.boolean(),
  balanceColors: z.boolean(),
  isFixed: z.boolean(),
});

const VariantsSchema = z
  .array(
    z.object({
      weight: z.number().positive(),
      slots: z.record(z.string(), z.number().int().nonnegative()),
    }),
  )
  .min(1);

const SheetsSchema = z.record(z.string(), SheetSchema);

const RaritySchema = z.enum(["common", "uncommon", "rare", "mythic", "special", "bonus"]);
const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

type FactsRow = {
  id: string;
  name: string;
  collector_number: string;
  rarity: string;
  colors: string[];
  finishes: string[];
  is_basic_land: boolean;
  prices: Record<string, number> | null;
};

function toFacts(row: FactsRow): PrintingFacts {
  const marketPrice: Partial<Record<Finish, Cents>> = {};
  for (const [finish, cents] of Object.entries(row.prices ?? {})) {
    marketPrice[FinishSchema.parse(finish)] = Cents.of(Number(cents));
  }
  return {
    name: row.name,
    collectorNumber: row.collector_number,
    rarity: RaritySchema.parse(row.rarity),
    colors: row.colors.map((color) => ColorSchema.parse(color)),
    finishes: row.finishes.map((finish) => FinishSchema.parse(finish)),
    isBasicLand: row.is_basic_land,
    marketPrice,
  };
}

export function drizzleBoosterSource(db: DbExecutor): BoosterSource {
  async function boosterConfig(key: BoosterKey): Promise<BoosterConfig | null> {
    const [row] = await db
      .select({
        setCode: boosterConfigs.setCode,
        boosterType: boosterConfigs.boosterType,
        variants: boosterConfigs.variants,
        sheets: boosterConfigs.sheets,
        sourceSetCodes: boosterConfigs.sourceSetCodes,
      })
      .from(boosterConfigs)
      // Any set, enabled or not: a pack someone owns must stay openable if its set is disabled.
      .where(
        and(
          eq(boosterConfigs.setCode, key.setCode),
          eq(boosterConfigs.boosterType, key.boosterType),
        ),
      );
    if (row === undefined) return null;
    return {
      setCode: SetCode.of(row.setCode),
      boosterType: row.boosterType,
      variants: VariantsSchema.parse(row.variants),
      sheets: SheetsSchema.parse(row.sheets),
      sourceSetCodes: row.sourceSetCodes.map(SetCode.of),
    };
  }

  async function printingFacts(
    printingIds: readonly PrintingId[],
  ): Promise<Map<PrintingId, PrintingFacts>> {
    if (printingIds.length === 0) return new Map();
    const result = await db.execute<FactsRow>(sql`
      select p.id, p.name, p.collector_number, p.rarity, p.colors, p.finishes,
             p.type_line ~ '^Basic\\y.*\\yLand\\y' as is_basic_land,
             -- For each finish, the newest snapshot's price.
             (select jsonb_object_agg(latest.finish, latest.usd_cents)
                from (select distinct on (s.finish) s.finish, s.usd_cents
                        from price_snapshots s
                       where s.printing_id = p.id
                       order by s.finish, s.day desc) latest) as prices
        from printings p
       where p.id = any(${sql.param([...printingIds])}::text[]) -- one array parameter, not a list
    `);
    return new Map(result.rows.map((row) => [PrintingId.of(row.id), toFacts(row)]));
  }

  async function boosterKeys(): Promise<BoosterKey[]> {
    const rows = await db
      .select({ setCode: boosterConfigs.setCode, boosterType: boosterConfigs.boosterType })
      .from(boosterConfigs)
      .innerJoin(cardSets, eq(cardSets.code, boosterConfigs.setCode))
      .where(eq(cardSets.isEnabled, true))
      .orderBy(boosterConfigs.setCode, boosterConfigs.boosterType);
    return rows.map((row) => ({ setCode: SetCode.of(row.setCode), boosterType: row.boosterType }));
  }

  return { boosterConfig, printingFacts, boosterKeys };
}
