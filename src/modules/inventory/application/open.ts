import type { Actor } from "@/modules/accounts";
import { receiveCards, type CardGain } from "@/modules/collection";
import { openBooster, type Pack } from "@/modules/packs";
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
import type { DeckCardGain, InventoryDependencies, InventoryServices } from "./ports";

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

/**
 * Opens an item that has already passed `openTransition` (so it's locked, owned, and now marked
 * opened in memory). `newSeed` gives a fresh seed for anything random inside.
 */
async function openContent(
  services: InventoryServices,
  item: Item,
  now: Date,
  newSeed: () => string,
): Promise<Result<Opening, ContentError>> {
  const ref = `item:${item.id}`;
  const content = item.content;

  switch (content.kind) {
    case "pack": {
      const seed = newSeed();
      const opened = await openBooster(services, {
        setCode: content.setCode,
        boosterType: content.boosterType,
        seed,
      });
      if (!opened.ok) return opened;
      const pack = opened.value;
      if (pack.cards.length === 0) return err({ kind: "NothingInside" });
      await receiveCards(services, item.ownerId, packGains(pack), { source: "pack", ref, at: now });
      await services.items.markOpened(item, {
        kind: "pack",
        seed,
        variantIndex: pack.variantIndex,
        cards: pack.cards,
      });
      return ok({ kind: "pack", item, pack });
    }

    case "deck": {
      const deck = await services.productCatalog.deckCards(content.setCode, content.deckName);
      if (deck === null) return err({ kind: "DeckUnavailable" });
      if (deck.cards.length === 0) return err({ kind: "NothingInside" });
      await receiveCards(services, item.ownerId, deck.cards, { source: "deck", ref, at: now });
      await services.items.markOpened(item, { kind: "deck", cards: deck.cards });
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
      await receiveCards(services, item.ownerId, plan.cards, { source: "product", ref, at: now });
      await services.items.markOpened(item, {
        kind: "product",
        seed,
        childIds: children.map((child) => child.id),
        cards: plan.cards,
        extras: plan.extras,
      });
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
export const OPEN_ALL_LIMIT = 500;

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
      const openings: Opening[] = [];
      const waiting: ItemId[] = [...itemIds];
      // A queue, oldest first: each opened product adds its children to the end.
      for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
        if (openings.length >= OPEN_ALL_LIMIT) break; // the rest stay unopened, safe to open later
        const opened = await openInTransaction(services, actor, next, now, seeds.newSeed);
        if (!opened.ok) return opened;
        openings.push(opened.value);
        if (opened.value.kind === "product") {
          waiting.push(...opened.value.children.map((child) => child.id));
        }
      }
      return ok(openings);
    });
  }

  return openAll;
}
