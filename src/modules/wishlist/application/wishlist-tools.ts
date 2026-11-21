import type { Actor } from "@/modules/accounts";
import { Cents, ok, type Result } from "@/shared/kernel";
import { type Finish } from "@/shared/mtg";
import { totals, wishLines, type WishLine, type WishlistAnswers } from "../domain/lines";
import type { FinishPreference, WishDetails, WishId as WishIdOf } from "../domain/wish";
import type { AddedWish, AddWishError, AddWishInput, WishRequest } from "./manage-wishes";

// The wishlist as the player and the model use it (audit S1): the list with what each wish costs
// now, adding wishes by card name, removing them by id. Buying stays in the web app.

export type WishlistViewReaders = Readonly<{
  answers(actor: Actor): Promise<WishlistAnswers>;
  /** The balance (brought up to date) and when and how much the allowance pays. */
  outlook(actor: Actor): Promise<
    Readonly<{
      balance: Cents;
      allowance: Cents;
      allowancePeriodDays: number;
      nextPayday: Date;
    }>
  >;
}>;

export type WishlistView = Readonly<{
  balance: Cents;
  /** What every wish still missing would cost, today. */
  totalForMissing: Cents;
  lines: readonly WishLine[];
}>;

export function makeWishlistView(readers: WishlistViewReaders) {
  async function wishlistView(actor: Actor): Promise<Result<WishlistView, never>> {
    const [answers, outlook] = await Promise.all([readers.answers(actor), readers.outlook(actor)]);
    const lines = wishLines(answers, outlook);
    return ok({ balance: outlook.balance, totalForMissing: totals(lines).all, lines });
  }
  return wishlistView;
}

/** One card to wish for, as a model or a form writes it. */
export type WishToAdd = Readonly<{
  card: string;
  printing: "any" | "exact";
  finish: Finish | "cheapest";
  quantity: number;
  targetPriceCents?: number;
  note: string;
}>;

export type AddWishesReport = Readonly<{
  added: ReadonlyArray<Readonly<{ wishId: number; card: string; isNew: boolean }>>;
  errors: ReadonlyArray<Readonly<{ card: string; kind: string; message: string }>>;
}>;

export type AddWishesReaders = Readonly<{
  findCard(nameOrId: string): Promise<Readonly<{ printingId: string; name: string }> | null>;
  addWish(actor: Actor, input: AddWishInput): Promise<Result<AddedWish, AddWishError>>;
}>;

function errorText(error: AddWishError): string {
  switch (error.kind) {
    case "FinishNotAvailable":
      return `Available finishes: ${error.finishes.join(", ")}.`;
    case "WishlistFull":
      return `The wishlist holds at most ${error.max} wishes.`;
    case "InvalidWish":
      return error.reason;
    case "CardNotFound":
      return "Card not found.";
  }
}

export function makeAddWishes(readers: AddWishesReaders) {
  async function addWishes(
    request: Readonly<{ actor: Actor; wishes: readonly WishToAdd[] }>,
  ): Promise<Result<AddWishesReport, never>> {
    const added: Array<{ wishId: number; card: string; isNew: boolean }> = [];
    const errors: Array<{ card: string; kind: string; message: string }> = [];
    for (const item of request.wishes) {
      const found = await readers.findCard(item.card);
      if (found === null) {
        errors.push({ card: item.card, kind: "CardNotFound", message: "Not in catalog." });
        continue;
      }
      let wish: WishRequest;
      if (item.printing === "any") {
        if (item.finish === "etched") {
          errors.push({
            card: item.card,
            kind: "InvalidWish",
            message: 'For "any" printing, finish must be nonfoil, foil, or cheapest.',
          });
          continue;
        }
        wish = {
          kind: "anyPrinting",
          printingId: found.printingId,
          finish: item.finish as FinishPreference,
        };
      } else {
        if (item.finish === "cheapest") {
          errors.push({
            card: item.card,
            kind: "InvalidWish",
            message: 'For an "exact" printing, finish must be nonfoil, foil, or etched.',
          });
          continue;
        }
        wish = { kind: "exactPrinting", printingId: found.printingId, finish: item.finish };
      }
      const details: WishDetails = {
        quantity: item.quantity,
        targetPrice: item.targetPriceCents === undefined ? null : Cents.of(item.targetPriceCents),
        note: item.note,
      };
      const result = await readers.addWish(request.actor, { request: wish, details });
      if (!result.ok) {
        errors.push({ card: item.card, kind: result.error.kind, message: errorText(result.error) });
        continue;
      }
      added.push({ wishId: result.value.wish.id, card: found.name, isNew: result.value.isNew });
    }
    return ok({ added, errors });
  }
  return addWishes;
}

export type RemoveWishesReaders = Readonly<{
  removeWish(actor: Actor, wishId: WishIdOf): Promise<Result<void, unknown>>;
}>;

export function makeRemoveWishes(
  readers: RemoveWishesReaders,
  makeId: (value: number) => WishIdOf,
) {
  async function removeWishes(
    request: Readonly<{ actor: Actor; wishIds: readonly number[] }>,
  ): Promise<Result<{ removed: number[]; notFound: number[] }, never>> {
    const removed: number[] = [];
    const notFound: number[] = [];
    for (const id of request.wishIds) {
      const result = await readers.removeWish(request.actor, makeId(id));
      (result.ok ? removed : notFound).push(id);
    }
    return ok({ removed, notFound });
  }
  return removeWishes;
}
