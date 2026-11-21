import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import {
  isValidQuantity,
  MAX_REAL_QUANTITY,
  type RealCopy,
  type RealCopyKey,
} from "../domain/copies";
import type {
  FinishNotAvailable,
  NotOwned,
  NotTheSameCard,
  PrintingNotFound,
  QuantityInvalid,
} from "../domain/errors";
import type { RealCollectionDependencies } from "./ports";

// Changing the real collection by hand (design doc 16, section 6). Only the owner changes it
// (rule 5): every use case works on the actor's own collection.

export type SetRealCopiesError = PrintingNotFound | FinishNotAvailable | QuantityInvalid;
export type ChangeRealPrintingError =
  NotOwned | PrintingNotFound | FinishNotAvailable | NotTheSameCard;

export function makeManageCopies(dependencies: RealCollectionDependencies) {
  const { unitOfWork, clock } = dependencies;

  /**
   * Sets how many copies of a printing in a finish the player owns for real. It takes the new
   * quantity, not "+1", so pressing a button twice or retrying can't add two copies.
   */
  async function setRealCopies(
    actor: Actor,
    copy: RealCopy,
  ): Promise<Result<RealCopy, SetRealCopiesError>> {
    if (!isValidQuantity(copy.quantity)) return err({ kind: "QuantityInvalid" });
    return unitOfWork.run<RealCopy, SetRealCopiesError>(
      async ({ realCollection, printingMatcher }) => {
        const facts = (await printingMatcher.facts([copy.printingId])).get(copy.printingId);
        if (facts === undefined) return err({ kind: "PrintingNotFound" });
        if (!facts.finishes.includes(copy.finish)) {
          return err({ kind: "FinishNotAvailable", finishes: [...facts.finishes] });
        }
        await realCollection.lock(actor.userId);
        await realCollection.set(actor.userId, copy, clock.now());
        return ok(copy);
      },
    );
  }

  /**
   * Moves a whole row to another printing of the same card (its oracle id). If the player
   * already has that printing and finish, the quantities are added together.
   */
  async function changeRealPrinting(
    actor: Actor,
    from: RealCopyKey,
    to: RealCopyKey,
  ): Promise<Result<RealCopy, ChangeRealPrintingError>> {
    return unitOfWork.run<RealCopy, ChangeRealPrintingError>(
      async ({ realCollection, printingMatcher }) => {
        await realCollection.lock(actor.userId);
        const copies = await realCollection.copies(actor.userId);
        const same = (key: RealCopyKey) => (copy: RealCopy) =>
          copy.printingId === key.printingId && copy.finish === key.finish;
        const moving = copies.find(same(from));
        if (moving === undefined) return err({ kind: "NotOwned" });

        const facts = await printingMatcher.facts([from.printingId, to.printingId]);
        const target = facts.get(to.printingId);
        if (target === undefined) return err({ kind: "PrintingNotFound" });
        if (!target.finishes.includes(to.finish)) {
          return err({ kind: "FinishNotAvailable", finishes: [...target.finishes] });
        }
        if (facts.get(from.printingId)?.oracleId !== target.oracleId)
          return err({ kind: "NotTheSameCard" });
        if (from.printingId === to.printingId && from.finish === to.finish) return ok(moving);

        const already = copies.find(same(to))?.quantity ?? 0;
        const moved: RealCopy = {
          ...to,
          quantity: Math.min(MAX_REAL_QUANTITY, already + moving.quantity),
        };
        const now = clock.now();
        await realCollection.set(actor.userId, { ...from, quantity: 0 }, now);
        await realCollection.set(actor.userId, moved, now);
        return ok(moved);
      },
    );
  }

  /** Empties the player's real collection (the page asks them to confirm). Returns rows removed. */
  async function clearRealCollection(actor: Actor): Promise<number> {
    const result = await unitOfWork.run<number, never>(async ({ realCollection }) => {
      await realCollection.lock(actor.userId);
      return ok(await realCollection.clear(actor.userId));
    });
    if (!result.ok) throw new Error("unreachable");
    return result.value;
  }

  /** Rule 5: lets the other players look at (never change) the real collection, or stops it. */
  async function setRealSharing(actor: Actor, isShared: boolean): Promise<void> {
    await unitOfWork.run<void, never>(async ({ realCollection }) => {
      await realCollection.setShared(actor.userId, isShared, clock.now());
      return ok(undefined);
    });
  }

  return { setRealCopies, changeRealPrinting, clearRealCollection, setRealSharing };
}
