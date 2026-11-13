import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import {
  planPackageInsert,
  type PackageEntrySpec,
  type PackageInsertPlan,
} from "../domain/packages";
import { cardPackageEntries, cardPackages, deckEntries } from "../infrastructure/schema";
import { deckView } from "./decks";

export type CardPackageSummary = Readonly<{
  id: number;
  name: string;
  description: string;
  tags: readonly string[];
  cardCount: number;
  entries: readonly {
    oracleId: string;
    name: string;
    quantity: number;
    heading: string | null;
    note: string | null;
  }[];
}>;

export async function listCardPackages(
  db: DbExecutor,
  userId: UserId,
): Promise<CardPackageSummary[]> {
  const pkgRows = await db
    .select()
    .from(cardPackages)
    .where(eq(cardPackages.ownerId, userId))
    .orderBy(desc(cardPackages.updatedAt));

  if (pkgRows.length === 0) return [];

  const entryRows = await db.execute<{
    package_id: number;
    oracle_id: string;
    name: string;
    quantity: number;
    heading: string | null;
    note: string | null;
  }>(sql`
    select e.package_id,
           e.oracle_id,
           coalesce((select p.name from printings p where p.oracle_id = e.oracle_id limit 1), e.oracle_id) as name,
           e.quantity,
           e.heading,
           e.note
      from card_package_entries e
      join card_packages pkg on pkg.id = e.package_id
     where pkg.owner_id = ${userId}
     order by e.package_id, name
  `);

  const byPkg = new Map<number, CardPackageSummary["entries"][number][]>();
  for (const row of entryRows.rows) {
    const list = byPkg.get(Number(row.package_id)) ?? [];
    list.push({
      oracleId: row.oracle_id,
      name: row.name,
      quantity: Number(row.quantity),
      heading: row.heading,
      note: row.note,
    });
    byPkg.set(Number(row.package_id), list);
  }

  return pkgRows.map((pkg) => {
    const entries = byPkg.get(pkg.id) ?? [];
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      tags: pkg.tags,
      cardCount: entries.reduce((sum, e) => sum + e.quantity, 0),
      entries,
    };
  });
}

export async function createCardPackage(
  db: DbExecutor,
  userId: UserId,
  input: {
    name: string;
    description?: string;
    tags?: readonly string[];
    entries: readonly {
      oracleId: string;
      quantity?: number;
      heading?: string | null;
      note?: string | null;
    }[];
  },
): Promise<{ id: number; name: string; entryCount: number }> {
  const [created] = await db
    .insert(cardPackages)
    .values({
      ownerId: userId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      tags: [...(input.tags ?? [])],
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .returning({ id: cardPackages.id, name: cardPackages.name });

  if (input.entries.length > 0) {
    await db.insert(cardPackageEntries).values(
      input.entries.map((entry) => ({
        packageId: created.id,
        oracleId: entry.oracleId,
        quantity: Math.max(1, Math.min(99, entry.quantity ?? 1)),
        heading: entry.heading ?? null,
        note: entry.note ?? null,
      })),
    );
  }

  return { id: created.id, name: created.name, entryCount: input.entries.length };
}

export async function applyCardPackageToDeck(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  packageId: number,
): Promise<PackageInsertPlan | null> {
  const view = await deckView(db, userId, deckId);
  if (view === null) return null;

  const [pkg] = await db
    .select({ id: cardPackages.id })
    .from(cardPackages)
    .where(and(eq(cardPackages.id, packageId), eq(cardPackages.ownerId, userId)));
  if (!pkg) return null;

  const entryRows = await db.execute<{
    oracle_id: string;
    quantity: number;
    heading: string | null;
    note: string | null;
    name: string;
    color_identity: string[];
    legalities: Record<string, string> | null;
    is_basic_land: boolean;
  }>(sql`
    select e.oracle_id,
           e.quantity,
           e.heading,
           e.note,
           p.name,
           p.color_identity,
           p.legalities,
           (p.type_line ~ '^Basic\\y.*\\yLand\\y') as is_basic_land
      from card_package_entries e
      join lateral (
        select pr.name, pr.color_identity, pr.legalities, pr.type_line
          from printings pr
         where pr.oracle_id = e.oracle_id
         order by pr.legalities is not null desc
         limit 1
      ) p on true
     where e.package_id = ${packageId}
  `);

  const specs: PackageEntrySpec[] = entryRows.rows.map((row) => ({
    oracleId: row.oracle_id,
    name: row.name,
    quantity: Number(row.quantity),
    heading: row.heading,
    note: row.note,
    colorIdentity: row.color_identity,
    legalities: row.legalities ?? {},
    isBasicLand: Boolean(row.is_basic_land),
  }));

  const commanderColors: string[] | null =
    view.deck.format === "commander"
      ? [
          ...new Set(
            view.lines
              .filter((l) => l.board === "commander")
              .flatMap((l) => view.rules[l.oracleId]?.colorIdentity ?? []),
          ),
        ]
      : null;

  const existingMain = view.lines
    .filter((l) => l.board === "main")
    .map((l) => ({ oracleId: l.oracleId, quantity: l.quantity }));

  const plan = planPackageInsert(specs, existingMain, view.deck.format, commanderColors);

  for (const item of plan.toAdd) {
    await db
      .insert(deckEntries)
      .values({
        deckId,
        oracleId: item.oracleId,
        board: "main",
        quantity: item.finalQuantity,
        heading: item.heading,
        note: item.note,
      })
      .onConflictDoUpdate({
        target: [deckEntries.deckId, deckEntries.oracleId, deckEntries.board],
        set: {
          quantity: item.finalQuantity,
          ...(item.heading !== null ? { heading: item.heading } : {}),
          ...(item.note !== null ? { note: item.note } : {}),
        },
      });
  }

  return plan;
}
