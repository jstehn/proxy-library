import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  PrintingId,
  SealedProductId,
  SetCode,
  type SealedContent,
  type SealedProduct,
} from "@/modules/catalog";
import { deckLists, sealedProducts } from "@/modules/catalog/infrastructure/schema";
import type { DbExecutor } from "@/shared/db";
import { assertNever, UserId } from "@/shared/kernel";
import type {
  DeckContents,
  ItemRepository,
  NewItemsInput,
  ProductCatalog,
  StoredOpening,
} from "../application/ports";
import { ItemId, type Item, type ItemContent, type ItemOrigin } from "../domain/item";
import { itemOpenings, sealedItems } from "./schema";

type ItemRow = typeof sealedItems.$inferSelect;

const OriginSchema = z.enum(["purchase", "unpacked"]) satisfies z.ZodType<ItemOrigin>;

/** The columns that describe an item's content, for inserting. */
function contentColumns(content: ItemContent) {
  switch (content.kind) {
    case "product":
      return { contentKind: "product", productId: content.productId };
    case "pack":
      return { contentKind: "pack", setCode: content.setCode, boosterType: content.boosterType };
    case "deck":
      return { contentKind: "deck", setCode: content.setCode, deckName: content.deckName };
    default:
      return assertNever(content);
  }
}

/** A row back to an Item. The CHECK constraints guarantee the columns each kind needs. */
function toItem(row: ItemRow): Item {
  function content(): ItemContent {
    if (row.contentKind === "pack" && row.setCode !== null && row.boosterType !== null) {
      return { kind: "pack", setCode: SetCode.of(row.setCode), boosterType: row.boosterType };
    }
    if (row.contentKind === "deck" && row.setCode !== null && row.deckName !== null) {
      return { kind: "deck", setCode: SetCode.of(row.setCode), deckName: row.deckName };
    }
    if (row.contentKind === "product" && row.productId !== null) {
      return { kind: "product", productId: SealedProductId.of(row.productId) };
    }
    throw new Error(`sealed item ${row.id} has an impossible shape`);
  }

  return {
    id: ItemId.of(row.id),
    ownerId: UserId.of(row.ownerId),
    content: content(),
    name: row.name,
    productId: row.productId === null ? null : SealedProductId.of(row.productId),
    parentId: row.parentId === null ? null : ItemId.of(row.parentId),
    status: row.status === "opened" ? "opened" : "unopened",
    origin: OriginSchema.parse(row.origin),
    acquiredAt: row.acquiredAt,
    openedAt: row.openedAt,
  };
}

export function drizzleItemRepository(db: DbExecutor): ItemRepository {
  async function add(input: NewItemsInput): Promise<Item[]> {
    if (input.items.length === 0) return [];
    const rows = await db
      .insert(sealedItems)
      .values(
        input.items.map((item) => ({
          ownerId: input.ownerId,
          ...contentColumns(item.content),
          name: item.name,
          productId: item.productId,
          parentId: input.parentId,
          status: "unopened",
          origin: input.origin,
          acquiredAt: input.at,
        })),
      )
      .returning();
    // Postgres returns inserted rows in the order they were given.
    return rows.map(toItem);
  }

  async function lock(itemId: ItemId): Promise<Item | null> {
    const [row] = await db
      .select()
      .from(sealedItems)
      .where(eq(sealedItems.id, itemId))
      .for("update");
    return row === undefined ? null : toItem(row);
  }

  async function markOpened(item: Item, opening: StoredOpening): Promise<void> {
    await db
      .update(sealedItems)
      .set({ status: "opened", openedAt: item.openedAt })
      .where(eq(sealedItems.id, item.id));
    await db.insert(itemOpenings).values({
      itemId: item.id,
      seed: opening.kind === "deck" ? null : opening.seed,
      result: opening,
    });
  }

  return { add, lock, markOpened };
}

// Stored catalog JSON, checked again on the way in ("parse, don't validate").

const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

/** A product's contents: a tree, so the schema refers to itself (z.lazy delays the lookup). */
const SealedContentSchema: z.ZodType<SealedContent> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("pack"),
      setCode: z.string().transform(SetCode.of),
      boosterType: z.string(),
    }),
    z.object({
      kind: z.literal("sealed"),
      productId: z.string().transform(SealedProductId.of),
      count: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal("card"),
      printingId: z.string().transform(PrintingId.of),
      finish: FinishSchema,
    }),
    z.object({
      kind: z.literal("deck"),
      setCode: z.string().transform(SetCode.of),
      deckName: z.string(),
    }),
    z.object({ kind: z.literal("other"), name: z.string() }),
    z.object({ kind: z.literal("variable"), options: z.array(z.array(SealedContentSchema)) }),
  ]),
);

const DeckCardsSchema = z.array(
  z.object({
    printingId: z.string().transform(PrintingId.of),
    count: z.number().int().positive(),
    finish: FinishSchema,
    board: z.enum(["commander", "main", "side"]),
  }),
);

export function drizzleProductCatalog(db: DbExecutor): ProductCatalog {
  async function products(
    productIds: readonly SealedProductId[],
  ): Promise<Map<SealedProductId, SealedProduct>> {
    if (productIds.length === 0) return new Map();
    const rows = await db
      .select()
      .from(sealedProducts)
      .where(inArray(sealedProducts.id, [...new Set(productIds)]));
    return new Map(
      rows.map((row) => {
        const id = SealedProductId.of(row.id);
        const product: SealedProduct = {
          id,
          setCode: SetCode.of(row.setCode),
          name: row.name,
          category: row.category,
          subtype: row.subtype,
          releaseDate: row.releaseDate,
          contents: z.array(SealedContentSchema).parse(row.contents),
        };
        return [id, product];
      }),
    );
  }

  async function deckCards(setCode: SetCode, deckName: string): Promise<DeckContents | null> {
    const [row] = await db
      .select({ type: deckLists.type, cards: deckLists.cards })
      .from(deckLists)
      .where(and(eq(deckLists.setCode, setCode), eq(deckLists.name, deckName)));
    if (row === undefined) return null;
    return {
      type: row.type,
      cards: DeckCardsSchema.parse(row.cards).map((card) => ({
        printingId: card.printingId,
        finish: card.finish,
        quantity: card.count,
        board: card.board,
      })),
    };
  }

  return { products, deckCards };
}
