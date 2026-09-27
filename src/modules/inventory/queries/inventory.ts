import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import { itemOpenings, sealedItems } from "../infrastructure/schema";

// Read models for the inventory screens (ADR 0006).

/** Unopened items that look the same, grouped: "Bloomburrow Play Booster Pack × 9". */
export type UnopenedGroup = Readonly<{
  name: string;
  contentKind: "product" | "pack" | "deck";
  productId: string | null;
  setCode: string | null;
  /** Every item in the group, oldest first. "Open" opens the first; "Open all" opens them all. */
  itemIds: number[];
}>;

export async function unopenedItems(db: DbExecutor, userId: UserId): Promise<UnopenedGroup[]> {
  const rows = await db
    .select({
      name: sealedItems.name,
      contentKind: sealedItems.contentKind,
      productId: sealedItems.productId,
      // A product item has no set code of its own; its packs and decks do.
      setCode: sql<string | null>`min(${sealedItems.setCode})`,
      itemIds: sql<number[]>`array_agg(${sealedItems.id} order by ${sealedItems.id})`,
    })
    .from(sealedItems)
    .where(and(eq(sealedItems.ownerId, userId), eq(sealedItems.status, "unopened")))
    .groupBy(sealedItems.name, sealedItems.contentKind, sealedItems.productId)
    .orderBy(sealedItems.name);

  return rows.map((row) => ({
    name: row.name,
    // The CHECK constraint allows only these three.
    contentKind: row.contentKind as UnopenedGroup["contentKind"],
    productId: row.productId,
    setCode: row.setCode,
    itemIds: row.itemIds.map(Number),
  }));
}

export type RecentOpening = Readonly<{
  itemId: number;
  name: string;
  contentKind: string;
  openedAt: string;
}>;

/** The player's latest openings, newest first. */
export async function recentOpenings(
  db: DbExecutor,
  userId: UserId,
  limit = 20,
): Promise<RecentOpening[]> {
  const rows = await db
    .select({
      itemId: sealedItems.id,
      name: sealedItems.name,
      contentKind: sealedItems.contentKind,
      openedAt: sealedItems.openedAt,
    })
    .from(sealedItems)
    .where(and(eq(sealedItems.ownerId, userId), eq(sealedItems.status, "opened")))
    .orderBy(desc(sealedItems.openedAt), desc(sealedItems.id))
    .limit(limit);
  return rows.map((row) => ({
    itemId: row.itemId,
    name: row.name,
    contentKind: row.contentKind,
    openedAt: (row.openedAt ?? new Date(0)).toISOString(),
  }));
}

/** One card that came out of an opening. */
export type OpenedCard = Readonly<{
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  quantity: number;
}>;

export type OpeningView = Readonly<{
  itemId: number;
  name: string;
  contentKind: "product" | "pack" | "deck";
  openedAt: string;
  seed: string | null;
  /** For a pack, in reveal order; one entry per card. */
  cards: readonly OpenedCard[];
  extras: readonly string[];
  children: ReadonlyArray<{ itemId: number; name: string; status: string }>;
}>;

type StoredResult = {
  kind: "pack" | "deck" | "product";
  cards?: Array<{ printingId: string; finish: OpenedCard["finish"]; quantity?: number }>;
  extras?: string[];
};

/** What one of the player's openings produced, or null if it isn't theirs or isn't opened. */
export async function openingView(
  db: DbExecutor,
  userId: UserId,
  itemId: number,
): Promise<OpeningView | null> {
  const [row] = await db
    .select({
      itemId: sealedItems.id,
      name: sealedItems.name,
      contentKind: sealedItems.contentKind,
      openedAt: sealedItems.openedAt,
      seed: itemOpenings.seed,
      result: itemOpenings.result,
    })
    .from(sealedItems)
    .innerJoin(itemOpenings, eq(itemOpenings.itemId, sealedItems.id))
    .where(and(eq(sealedItems.id, itemId), eq(sealedItems.ownerId, userId)));
  if (row === undefined) return null;

  // Written by this module as a StoredOpening, so this shape is known.
  const result = row.result as StoredResult;
  const children = await db
    .select({ itemId: sealedItems.id, name: sealedItems.name, status: sealedItems.status })
    .from(sealedItems)
    .where(eq(sealedItems.parentId, row.itemId))
    .orderBy(sealedItems.id);

  return {
    itemId: row.itemId,
    name: row.name,
    contentKind: row.contentKind as OpeningView["contentKind"],
    openedAt: (row.openedAt ?? new Date(0)).toISOString(),
    seed: row.seed,
    cards: (result.cards ?? []).map((card) => ({
      printingId: card.printingId,
      finish: card.finish,
      quantity: card.quantity ?? 1,
    })),
    extras: result.extras ?? [],
    children,
  };
}
