import type { Actor } from "@/modules/accounts";
import type { Finish } from "@/modules/catalog";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type {
  CardNotFound,
  FinishNotAvailable,
  InvalidWish,
  WishlistFull,
  WishNotFound,
} from "../domain/errors";
import { offersFor } from "../domain/lines";
import {
  checkDetails,
  MAX_WISHES,
  type FinishPreference,
  type Wish,
  type WishDetails,
  type WishId,
  type WishTarget,
} from "../domain/wish";
import type { WishlistDependencies, WishlistServices } from "./ports";

// Adding, changing and removing wishes (design doc 26, section 5). Every use case works on the
// actor's own wishlist (rule 5).

/** What the card page asks for: this printing's card, or this exact printing. */
export type WishRequest =
  | Readonly<{ kind: "anyPrinting"; printingId: string; finish: FinishPreference }>
  | Readonly<{ kind: "exactPrinting"; printingId: string; finish: Finish }>;

export type AddWishInput = Readonly<{ request: WishRequest; details: WishDetails }>;
/** The wish as saved, and whether it's new or an existing wish that was updated (rule 1). */
export type AddedWish = Readonly<{ wish: Wish; isNew: boolean }>;

export type AddWishError = InvalidWish | CardNotFound | FinishNotAvailable | WishlistFull;
export type UpdateWishError = InvalidWish | WishNotFound;

export function makeManageWishes(dependencies: WishlistDependencies) {
  const { unitOfWork, clock } = dependencies;

  /**
   * Saves a wish. Wishing for the same thing again changes the existing wish's copies, target
   * and note, and keeps the price it was saved at (rule 1).
   */
  async function addWish(
    actor: Actor,
    input: AddWishInput,
  ): Promise<Result<AddedWish, AddWishError>> {
    const details = checkDetails(input.details);
    if (!details.ok) return details;

    return unitOfWork.run<AddedWish, AddWishError>(async ({ wishes, wishCatalog }) => {
      const target = await targetFor(wishCatalog, input.request);
      if (!target.ok) return target;

      await wishes.lock(actor.userId);
      const existing = await wishes.findByTarget(actor.userId, target.value);
      if (existing !== null) {
        await wishes.update(existing.id, details.value);
        return ok({ wish: { ...existing, ...details.value }, isNew: false });
      }
      if ((await wishes.count(actor.userId)) >= MAX_WISHES) {
        return err({ kind: "WishlistFull", max: MAX_WISHES });
      }

      const forSale = await wishCatalog.forSale(target.value.oracleId);
      const best = offersFor({ target: target.value }, forSale)[0];
      const wish = await wishes.insert({
        userId: actor.userId,
        target: target.value,
        ...details.value,
        savedPrice: best?.price ?? null,
        createdAt: clock.now(),
      });
      return ok({ wish, isNew: true });
    });
  }

  /** Changes how many copies you want, the target price, or the note. */
  async function updateWish(
    actor: Actor,
    wishId: WishId,
    changes: WishDetails,
  ): Promise<Result<Wish, UpdateWishError>> {
    const details = checkDetails(changes);
    if (!details.ok) return details;
    return unitOfWork.run<Wish, UpdateWishError>(async ({ wishes }) => {
      const wish = await wishes.find(wishId, actor.userId);
      if (wish === null) return err({ kind: "WishNotFound" });
      await wishes.update(wishId, details.value);
      return ok({ ...wish, ...details.value });
    });
  }

  async function removeWish(actor: Actor, wishId: WishId): Promise<Result<void, WishNotFound>> {
    return unitOfWork.run<void, WishNotFound>(async ({ wishes }) => {
      const wish = await wishes.find(wishId, actor.userId);
      if (wish === null) return err({ kind: "WishNotFound" });
      await wishes.delete(wishId);
      return ok(undefined);
    });
  }

  /** Lets other players in the playgroup see this player's wishlist (design doc 50). */
  async function setSharing(actor: Actor, isShared: boolean): Promise<void> {
    await unitOfWork.run(async ({ wishes }) => {
      await wishes.setSharing(actor.userId, isShared, clock.now());
      return ok(undefined);
    });
  }

  return { addWish, updateWish, removeWish, setSharing };
}

/** The wish's target, from the printing the card page was showing (rule 4). */
async function targetFor(
  wishCatalog: WishlistServices["wishCatalog"],
  request: WishRequest,
): Promise<Result<WishTarget, CardNotFound | FinishNotAvailable>> {
  const facts = await wishCatalog.printing(request.printingId);
  if (facts === null) return err({ kind: "CardNotFound" });
  if (request.kind === "anyPrinting") {
    return ok({ kind: "anyPrinting", oracleId: facts.oracleId, finish: request.finish });
  }
  if (!facts.finishes.includes(request.finish)) {
    return err({ kind: "FinishNotAvailable", finishes: [...facts.finishes] });
  }
  return ok({
    kind: "exactPrinting",
    oracleId: facts.oracleId,
    printingId: request.printingId,
    finish: request.finish,
  });
}

/**
 * Deletes a player's whole wishlist, inside the caller's transaction: part of "Start over"
 * (design doc 12; decided for design doc 26, decision 4). Returns how many wishes went.
 */
export async function deleteWishlist(
  services: Pick<WishlistServices, "wishes">,
  userId: UserId,
): Promise<number> {
  return services.wishes.deleteAllOf(userId);
}
