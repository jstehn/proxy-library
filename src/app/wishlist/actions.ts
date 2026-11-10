"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { cardsToGetFor, deckProblems, deckView } from "@/modules/decks";
import {
  WishId,
  type CardNeed,
  type WishedForCards,
  type AddWishError,
  type BuyWishError,
  type UpdateWishError,
  type WishDetails,
  type WishRequest,
} from "@/modules/wishlist";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents, type Result, type UserId } from "@/shared/kernel";

// Adding, changing, removing and buying wishes (design doc 26). The card page and the
// Wishlist page both use these.

export type WishState = { message: string | null; tone: "error" | "success" };

const FINISH = z.enum(["nonfoil", "foil", "etched"]);

const DetailsForm = z.object({
  quantity: z.coerce.number(),
  targetPrice: z.string().trim(),
  note: z.string(),
});

/** The quantity, target price ("" for none) and note fields, as the use cases take them. */
function readDetails(formData: FormData): Result<WishDetails, string> {
  const form = DetailsForm.safeParse({
    quantity: formData.get("quantity"),
    targetPrice: formData.get("targetPrice") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!form.success) return { ok: false, error: "Choose how many copies you want." };
  const { quantity, targetPrice, note } = form.data;
  if (targetPrice === "") return { ok: true, value: { quantity, targetPrice: null, note } };
  const cents = Cents.fromUsd(targetPrice);
  if (cents === null) return { ok: false, error: "Write the target price like 20 or 19.99." };
  return { ok: true, value: { quantity, targetPrice: cents, note } };
}

const RequestForm = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anyPrinting"),
    printingId: z.string().min(1),
    finish: z.enum(["nonfoil", "foil", "cheapest"]),
  }),
  z.object({ kind: z.literal("exactPrinting"), printingId: z.string().min(1), finish: FINISH }),
]);

function refresh(printingId?: string) {
  revalidatePath("/", "layout"); // the header's badge and balance
  revalidatePath("/wishlist");
  if (printingId !== undefined) revalidatePath(`/cards/${printingId}`);
}

export async function addWishAction(_previous: WishState, formData: FormData): Promise<WishState> {
  const actor = await requireActor();
  const request = RequestForm.safeParse({
    kind: formData.get("kind"),
    printingId: formData.get("printingId"),
    finish: formData.get("finish"),
  });
  if (!request.success) return { message: "Choose a printing and finish.", tone: "error" };
  const details = readDetails(formData);
  if (!details.ok) return { message: details.error, tone: "error" };

  const result = await getContainer().wishlist.addWish(actor, {
    request: request.data satisfies WishRequest,
    details: details.value,
  });
  if (!result.ok) return { message: addMessage(result.error), tone: "error" };
  refresh(request.data.printingId);
  return {
    message: result.value.isNew ? "Added to your wishlist." : "Your wish is updated.",
    tone: "success",
  };
}

const WishIdForm = z.coerce.number().int().positive();

export async function updateWishAction(
  _previous: WishState,
  formData: FormData,
): Promise<WishState> {
  const actor = await requireActor();
  const wishId = WishIdForm.safeParse(formData.get("wishId"));
  if (!wishId.success) return { message: "That wish is gone.", tone: "error" };
  const details = readDetails(formData);
  if (!details.ok) return { message: details.error, tone: "error" };

  const result = await getContainer().wishlist.updateWish(
    actor,
    WishId.of(wishId.data),
    details.value,
  );
  if (!result.ok) return { message: updateMessage(result.error), tone: "error" };
  refresh();
  return { message: "Saved.", tone: "success" };
}

/** A plain form action: the row disappears, so there's no message to show. */
export async function removeWishAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const wishId = WishIdForm.safeParse(formData.get("wishId"));
  if (!wishId.success) return;
  await getContainer().wishlist.removeWish(actor, WishId.of(wishId.data));
  refresh();
}

const BuyForm = z.object({
  wishId: z.coerce.number().int().positive(),
  printingId: z.string().min(1),
  finish: FINISH,
  quantity: z.coerce.number(),
  expectedUnitPrice: z.coerce.number().int().nonnegative(),
  name: z.string().max(200),
});

export async function buyWishAction(_previous: WishState, formData: FormData): Promise<WishState> {
  const actor = await requireActor();
  const form = BuyForm.safeParse({
    wishId: formData.get("wishId"),
    printingId: formData.get("printingId"),
    finish: formData.get("finish"),
    quantity: formData.get("quantity"),
    expectedUnitPrice: formData.get("expectedUnitPrice"),
    name: formData.get("name") ?? "",
  });
  if (!form.success) return { message: "Choose a printing and how many.", tone: "error" };
  const { wishId, expectedUnitPrice, name, ...line } = form.data;

  const result = await getContainer().wishlist.buyWish(actor, {
    ...line,
    wishId: WishId.of(wishId),
    expectedUnitPrice: Cents.of(expectedUnitPrice),
  });
  // A changed price or a filled wish means the page shows something else now.
  refresh(line.printingId);
  if (!result.ok) return { message: buyMessage(result.error), tone: "error" };
  const { receipt, isFulfilled } = result.value;
  // A filled wish leaves the list, and its form (and message) with it: say so at the top.
  if (isFulfilled) {
    const query = new URLSearchParams({ bought: name, paid: String(receipt.total) });
    redirect(`/wishlist?${query.toString()}`);
  }
  return { message: `Bought for ${Cents.format(receipt.total)}.`, tone: "success" };
}

const DeckIdForm = z.coerce.number().int().positive();

/**
 * "Wish for them all" on Cards to get, and "Wish for what it's short" on a deck (task 71). The
 * cards are worked out again here: the form says only which deck, or none for all of them.
 */
export async function wishForShortCardsAction(
  _previous: WishState,
  formData: FormData,
): Promise<WishState> {
  const actor = await requireActor();
  const rawDeckId = formData.get("deckId");
  let needs: CardNeed[];
  if (rawDeckId === null) {
    needs = await allDecksNeed(actor.userId);
  } else {
    const deckId = DeckIdForm.safeParse(rawDeckId);
    const forDeck = deckId.success ? await deckNeeds(actor.userId, deckId.data) : null;
    if (forDeck === null) return { message: "That deck is gone.", tone: "error" };
    needs = forDeck;
  }
  if (needs.length === 0)
    return { message: "Nothing to wish for: you own it all.", tone: "success" };

  const result = await getContainer().wishlist.wishForCards(actor, needs);
  if (!result.ok) return { message: "A card isn't in the catalog any more.", tone: "error" };
  refresh();
  return { message: wishedMessage(result.value), tone: "success" };
}

/** Each card your decks are short of, at the copies the hungriest deck uses (design doc 21). */
async function allDecksNeed(userId: UserId): Promise<CardNeed[]> {
  const toGet = await cardsToGetFor(getContainer().db, userId);
  return toGet.cards.map((card) => ({ oracleId: card.oracleId, quantity: card.needed }));
}

/**
 * The cards one deck is short of, as game copies: a wish counts only those, so the real copies
 * a deck may use (design doc 16) come off what it needs. Null when it isn't your deck.
 */
async function deckNeeds(userId: UserId, deckId: number): Promise<CardNeed[] | null> {
  const view = await deckView(getContainer().db, userId, deckId);
  if (view === null) return null;
  const lineOf = (oracleId: string) => view.lines.find((line) => line.oracleId === oracleId);
  const problems = deckProblems(
    view.deck,
    (oracleId) => view.rules[oracleId],
    (oracleId) => lineOf(oracleId)?.owned ?? 0,
  );
  return problems.flatMap((problem): CardNeed[] =>
    problem.kind === "Short"
      ? [
          {
            oracleId: problem.oracleId,
            quantity: problem.needed - (lineOf(problem.oracleId)?.ownedReal ?? 0),
          },
        ]
      : [],
  );
}

function wishedMessage(wished: WishedForCards): string {
  const { added, raised, unchanged, skipped } = wished;
  const parts: string[] = [];
  if (added > 0) parts.push(`added ${added} ${added === 1 ? "wish" : "wishes"}`);
  if (raised > 0) parts.push(`asked for more copies on ${raised}`);
  if (unchanged > 0) parts.push(`${unchanged} already on your wishlist`);
  if (skipped > 0) parts.push(`${skipped} didn't fit: your wishlist is full`);
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function addMessage(error: AddWishError): string {
  switch (error.kind) {
    case "InvalidWish":
      return error.reason;
    case "CardNotFound":
      return "That card isn't in the catalog.";
    case "FinishNotAvailable":
      return `This printing only comes in ${error.finishes.join(" and ")}.`;
    case "WishlistFull":
      return `Your wishlist is full (${error.max} wishes). Remove some first.`;
    default:
      return assertNever(error);
  }
}

function updateMessage(error: UpdateWishError): string {
  switch (error.kind) {
    case "InvalidWish":
      return error.reason;
    case "WishNotFound":
      return "That wish is gone.";
    default:
      return assertNever(error);
  }
}

function buyMessage(error: BuyWishError): string {
  switch (error.kind) {
    case "WishNotFound":
      return "That wish is gone.";
    case "AlreadyOwned":
      return "You already own every copy you wanted.";
    case "DoesNotFit":
      return "That printing isn't what this wish asks for.";
    case "BuyQuantityInvalid":
      return `You can buy 1 to ${error.max}: the copies you're still missing.`;
    case "QuantityInvalid":
      return `You can buy 1 to ${error.max} at a time.`;
    case "PricesChanged":
      return `The price went up since the page loaded: it's ${Cents.format(error.total)} now. Check it and buy again.`;
    case "NotForSale":
      return "This card's set isn't in the store any more.";
    case "NoPrice":
      return "There's no market price for this finish now, so the store can't sell it.";
    case "InsufficientFunds":
      return `Not enough money: you have ${Cents.format(error.balance)} and this costs ${Cents.format(error.required)}.`;
    default:
      return assertNever(error);
  }
}
