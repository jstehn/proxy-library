import type { Actor } from "@/modules/accounts";
import { isNotable, recordEvent } from "@/modules/activity";
import {
  receiveCardBatches,
  receiveCards,
  type CardGain,
  type CardGainBatch,
} from "@/modules/collection";
import {
  loadBooster,
  openPack,
  type BoosterKey,
  type FactsLookup,
  type LoadedBooster,
  type Pack,
} from "@/modules/packs";
import { assertNever, err, ok, seededRng, type Result } from "@/shared/kernel";
import type {
  AlreadyOpened,
  BoosterUnavailable,
  DeckUnavailable,
  ItemNotFound,
  NothingInside,
  ProductUnavailable,
} from "../domain/errors";
import { openTransition, type Item, type ItemId } from "../domain/item";
import { nestedProductIds, unpack } from "../domain/unpack";
import type {
  DeckCardGain,
  InventoryDependencies,
  InventoryServices,
  OpenedItemRecord,
} from "./ports";

// Opening items (design doc 06, section 5). Each opening is one transaction: the item is locked,
// marked opened, and what came out of it is saved, or nothing changes at all.

/** What opening one item produced. */
export type Opening =
  | Readonly<{ kind: "pack"; item: Item; pack: Pack }>
  | Readonly<{ kind: "deck"; item: Item; deckType: string; cards: readonly DeckCardGain[] }>
  | Readonly<{
      kind: "product";
      item: Item;
      children: readonly Item[];
      cards: readonly CardGain[];
      extras: readonly string[];
    }>;

export type OpenItemError =
  | ItemNotFound
  | AlreadyOpened
  | BoosterUnavailable
  | DeckUnavailable
  | ProductUnavailable
  | NothingInside;

type ContentError = BoosterUnavailable | DeckUnavailable | ProductUnavailable | NothingInside;

/** The pack engine's cards, as collection gains (one copy each). */
function packGains(pack: Pack): CardGain[] {
  return pack.cards.map((card) => ({
    printingId: card.printingId,
    finish: card.finish,
    quantity: 1,
  }));
}

/** Per-transaction cache and write buffers so multi-pack opens batch their SQL calls. */
type OpenBatch = {
  boosterCache: Map<string, LoadedBooster | null>;
  cardBatches: CardGainBatch[];
  openedItems: OpenedItemRecord[];
};

async function getBooster(
  services: InventoryServices,
  key: BoosterKey,
  batch?: OpenBatch,
): Promise<LoadedBooster | null> {
  const cacheKey = `${key.setCode}\0${key.boosterType}`;
  if (batch?.boosterCache.has(cacheKey)) return batch.boosterCache.get(cacheKey) ?? null;
  const loaded = await loadBooster(services, key);
  batch?.boosterCache.set(cacheKey, loaded);
  return loaded;
}

/** Tells the activity feed about a pack's notable cards, if it had any (design doc 11). */
async function recordPull(
  services: InventoryServices,
  item: Item,
  pack: Pack,
  facts: FactsLookup,
  now: Date,
): Promise<void> {
  const cards = pack.cards.flatMap((card) => {
    const printing = facts(card.printingId);
    const pulled = {
      printingId: card.printingId,
      name: printing.name,
      finish: card.finish,
      rarity: printing.rarity,
      priceCents: printing.marketPrice[card.finish] ?? null,
    };
    return isNotable(pulled) ? [pulled] : [];
  });
  await recordEvent(
    services,
    { kind: "pull", actorId: item.ownerId, itemId: item.id, itemName: item.name, cards },
    now,
  );
}

async function saveOpening(
  services: InventoryServices,
  item: Item,
  gains: readonly CardGain[],
  source: "pack" | "deck" | "product",
  now: Date,
  record: OpenedItemRecord,
  batch?: OpenBatch,
): Promise<void> {
  const acquisition = { source, ref: `item:${item.id}`, at: now };
  if (batch !== undefined) {
    if (gains.length > 0) batch.cardBatches.push({ gains, acquisition });
    batch.openedItems.push(record);
    return;
  }
  await receiveCards(services, item.ownerId, gains, acquisition);
  await services.items.markOpened(record.item, record.opening);
}

/**
 * Opens an item that has already passed `openTransition` (so it's locked, owned, and now marked
 * opened in memory). `newSeed` gives a fresh seed for anything random inside.
 */
async function openContent(
  services: InventoryServices,
  item: Item,
  now: Date,
  newSeed: () => string,
  batch?: OpenBatch,
): Promise<Result<Opening, ContentError>> {
  const content = item.content;

  switch (content.kind) {
    case "pack": {
      const loaded = await getBooster(services, content, batch);
      if (loaded === null) return err({ kind: "BoosterUnavailable" });
      const seed = newSeed();
      const pack = openPack(loaded.config, loaded.facts, seed);
      if (pack.cards.length === 0) return err({ kind: "NothingInside" });
      await saveOpening(
        services,
        item,
        packGains(pack),
        "pack",
        now,
        {
          item,
          opening: {
            kind: "pack",
            seed,
            variantIndex: pack.variantIndex,
            cards: pack.cards,
          },
        },
        batch,
      );
      await recordPull(services, item, pack, loaded.facts, now);
      return ok({ kind: "pack", item, pack });
    }

    case "deck": {
      const deck = await services.productCatalog.deckCards(content.setCode, content.deckName);
      if (deck === null) return err({ kind: "DeckUnavailable" });
      if (deck.cards.length === 0) return err({ kind: "NothingInside" });
      await saveOpening(
        services,
        item,
        deck.cards,
        "deck",
        now,
        { item, opening: { kind: "deck", cards: deck.cards } },
        batch,
      );
      return ok({ kind: "deck", item, deckType: deck.type, cards: deck.cards });
    }

    case "product": {
      const product = (await services.productCatalog.products([content.productId])).get(
        content.productId,
      );
      if (product === undefined) return err({ kind: "ProductUnavailable" });
      const nested = await services.productCatalog.products(nestedProductIds(product.contents));

      const seed = newSeed();
      const plan = unpack(product.contents, (id) => nested.get(id) ?? null, seededRng(seed));
      if (plan === null) return err({ kind: "ProductUnavailable" });
      if (plan.items.length === 0 && plan.cards.length === 0) return err({ kind: "NothingInside" });

      const children = await services.items.add({
        ownerId: item.ownerId,
        items: plan.items,
        origin: "unpacked",
        parentId: item.id,
        at: now,
      });
      await saveOpening(
        services,
        item,
        plan.cards,
        "product",
        now,
        {
          item,
          opening: {
            kind: "product",
            seed,
            childIds: children.map((child) => child.id),
            cards: plan.cards,
            extras: plan.extras,
          },
        },
        batch,
      );
      return ok({ kind: "product", item, children, cards: plan.cards, extras: plan.extras });
    }

    default:
      return assertNever(content);
  }
}

/** Locks, checks and opens one item, inside the caller's transaction. */
async function openInTransaction(
  services: InventoryServices,
  actor: Actor,
  itemId: ItemId,
  now: Date,
  newSeed: () => string,
): Promise<Result<Opening, OpenItemError>> {
  const locked = await services.items.lock(itemId);
  const transition = openTransition(locked, actor.userId, now);
  if (!transition.ok) return transition;
  return openContent(services, transition.value, now, newSeed);
}

/** Opens one item: a pack, a deck, or one level of a product. */
export function makeOpenItem(dependencies: InventoryDependencies) {
  const { unitOfWork, clock, seeds } = dependencies;

  async function openItem(actor: Actor, itemId: ItemId): Promise<Result<Opening, OpenItemError>> {
    return unitOfWork.run<Opening, OpenItemError>((services) =>
      openInTransaction(services, actor, itemId, clock.now(), seeds.newSeed),
    );
  }

  return openItem;
}

/** The most items one "open all" may open, counting everything inside (a case of boxes). */
const OPEN_ALL_LIMIT = 500;

/**
 * Opens items and then everything that comes out of them (a box's packs, a bundle's packs and
 * land pack), in one transaction. Returns every opening, parents before children.
 */
export function makeOpenAll(dependencies: InventoryDependencies) {
  const { unitOfWork, clock, seeds } = dependencies;

  async function openAll(
    actor: Actor,
    itemIds: readonly ItemId[],
  ): Promise<Result<Opening[], OpenItemError>> {
    return unitOfWork.run<Opening[], OpenItemError>(async (services) => {
      const now = clock.now();
      const batch: OpenBatch = {
        boosterCache: new Map(),
        cardBatches: [],
        openedItems: [],
      };
      const lockedItems = await services.items.lockMany(itemIds.slice(0, OPEN_ALL_LIMIT));
      const openings: Opening[] = [];
      const waiting: ItemId[] = [...itemIds];
      // A queue, oldest first: each opened product adds its children to the end.
      for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
        if (openings.length >= OPEN_ALL_LIMIT) break; // the rest stay unopened, safe to open later
        const locked = lockedItems.get(next) ?? null;
        const transition = openTransition(locked, actor.userId, now);
        if (!transition.ok) return transition;
        lockedItems.set(next, transition.value);
        const opened = await openContent(services, transition.value, now, seeds.newSeed, batch);
        if (!opened.ok) return opened;
        openings.push(opened.value);
        if (opened.value.kind === "product") {
          for (const child of opened.value.children) {
            lockedItems.set(child.id, child);
            waiting.push(child.id);
          }
        }
      }
      await receiveCardBatches(services, actor.userId, batch.cardBatches);
      await services.items.markOpenedMany(batch.openedItems);
      return ok(openings);
    });
  }

  return openAll;
}
