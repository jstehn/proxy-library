"use server";
import { z } from "zod";
import type { Actor } from "@/modules/accounts";
import { deckProblems } from "@/modules/decks";
import {
  WishId,
  describeAddWishError,
  describeBuyWishError,
  describeUpdateWishError,
  type CardNeed,
  type WishedForCards,
  type WishRequest,
} from "@/modules/wishlist";
import { checkbox, messageByField } from "@/server/form-action";
import { formAction, formRedirect, formVoid } from "@/server/form-action-instance";
import type { Reads } from "@/server/reads";
import { Cents, err, ok } from "@/shared/kernel";
import { FinishOrCheapestSchema, FinishSchema } from "@/shared/mtg";
import { boughtPath, revalidateWishlist, revalidateWishlistSharing, WISHLIST_PATH } from "./paths";

// Adding, changing, removing and buying wishes (design doc 26). The card page and the
// Wishlist page both use these.

const WishIdField = z.coerce.number().int().positive();

/** "" means no target price; anything else must read as dollars. */
const TargetPriceField = z
  .string()
  .trim()
  .default("")
  .transform((text, context): Cents | null => {
    if (text === "") return null;
    const cents = Cents.fromUsd(text);
    if (cents === null) {
      context.issues.push({ code: "custom", message: "Not dollars.", input: text });
      return z.NEVER;
    }
    return cents;
  });

/** The quantity, target price and note fields, as the use cases take them. */
const DetailsFields = {
  quantity: z.coerce.number(),
  targetPrice: TargetPriceField,
  note: z.string().default(""),
};

/** What the forms say about a field that doesn't read; other problems are about the card. */
const DETAILS_MESSAGES = {
  quantity: "Choose how many copies you want.",
  targetPrice: "Write the target price like 20 or 19.99.",
};

// The request fields come first, so a bad printing is reported before a bad quantity.
const AddForm = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anyPrinting"),
    printingId: z.string().min(1),
    finish: FinishOrCheapestSchema.exclude(["etched"]),
    ...DetailsFields,
  }),
  z.object({
    kind: z.literal("exactPrinting"),
    printingId: z.string().min(1),
    finish: FinishSchema,
    ...DetailsFields,
  }),
]);

export const addWishAction = formAction(
  AddForm,
  async ({ actor, capabilities }, input) => {
    const { quantity, targetPrice, note, ...request } = input;
    const result = await capabilities.wishlist.addWish(actor, {
      request: request satisfies WishRequest,
      details: { quantity, targetPrice, note },
    });
    if (result.ok) revalidateWishlist(input.printingId);
    return result;
  },
  {
    describeError: describeAddWishError,
    invalidInput: messageByField(DETAILS_MESSAGES, "Choose a printing and finish."),
    successMessage: (added) => (added.isNew ? "Added to your wishlist." : "Your wish is updated."),
  },
);

export const updateWishAction = formAction(
  z.object({ wishId: WishIdField, ...DetailsFields }),
  async ({ actor, capabilities }, { wishId, quantity, targetPrice, note }) => {
    const result = await capabilities.wishlist.updateWish(actor, WishId.of(wishId), {
      quantity,
      targetPrice,
      note,
    });
    if (result.ok) revalidateWishlist();
    return result;
  },
  {
    describeError: describeUpdateWishError,
    invalidInput: messageByField(
      { ...DETAILS_MESSAGES, wishId: "That wish is gone." },
      "Check the form.",
    ),
    successMessage: "Saved.",
  },
);

/** A plain form action: the row disappears, so there's no message to show. */
export const removeWishAction = formVoid(
  z.object({ wishId: WishIdField }),
  async ({ actor, capabilities }, { wishId }) => {
    await capabilities.wishlist.removeWish(actor, WishId.of(wishId));
    revalidateWishlist();
  },
);

/** "Let other players see my wishlist" (design doc 50, off by default). */
export const setWishlistSharingAction = formRedirect(
  z.object({ shared: checkbox() }),
  async ({ actor, capabilities }, { shared }) => {
    await capabilities.wishlist.setSharing(actor, shared);
    revalidateWishlistSharing();
    return WISHLIST_PATH;
  },
);

export const buyWishAction = formAction(
  z.object({
    wishId: WishIdField,
    printingId: z.string().min(1),
    finish: FinishSchema,
    quantity: z.coerce.number(),
    expectedUnitPrice: z.coerce.number().int().nonnegative(),
    name: z.string().max(200).default(""),
  }),
  async ({ actor, capabilities }, { wishId, expectedUnitPrice, name, ...line }) => {
    const result = await capabilities.wishlist.buyWish(actor, {
      ...line,
      wishId: WishId.of(wishId),
      expectedUnitPrice: Cents.of(expectedUnitPrice),
    });
    // A changed price or a filled wish means the page shows something else now.
    revalidateWishlist(line.printingId);
    return result.ok ? ok({ ...result.value, name }) : result;
  },
  {
    describeError: describeBuyWishError,
    invalidInput: "Choose a printing and how many.",
    // A filled wish leaves the list, and its form (and message) with it: say so at the top.
    redirectTo: ({ isFulfilled, receipt, name }) =>
      isFulfilled ? boughtPath(name, receipt.total) : undefined,
    successMessage: ({ receipt }) => `Bought for ${Cents.format(receipt.total)}.`,
  },
);

/** What "wish for short cards" found: nothing to wish for, or what the wishlist did. */
type ShortCardsOutcome = Readonly<
  { kind: "ownedAll" } | { kind: "wished"; wished: WishedForCards }
>;

/**
 * "Wish for them all" on Cards to get, and "Wish for what it's short" on a deck (task 71). The
 * cards are worked out again here: the form says only which deck, or none for all of them.
 */
export const wishForShortCardsAction = formAction(
  z.object({ deckId: WishIdField.optional() }),
  async ({ actor, capabilities, reads }, { deckId }) => {
    const needs =
      deckId === undefined
        ? await allDecksNeed(reads, actor)
        : await deckNeeds(reads, actor, deckId);
    if (needs === null) return err("DeckGone" as const);
    if (needs.length === 0) return ok<ShortCardsOutcome>({ kind: "ownedAll" });
    const result = await capabilities.wishlist.wishForCards(actor, needs);
    if (!result.ok) return err("NotInCatalog" as const);
    revalidateWishlist();
    return ok<ShortCardsOutcome>({ kind: "wished", wished: result.value });
  },
  {
    describeError: (failure) =>
      failure === "DeckGone" ? "That deck is gone." : "A card isn't in the catalog any more.",
    invalidInput: "That deck is gone.",
    successMessage: (outcome) =>
      outcome.kind === "ownedAll"
        ? "Nothing to wish for: you own it all."
        : wishedMessage(outcome.wished),
  },
);

/** Each card your decks are short of, at the copies the hungriest deck uses (design doc 21). */
async function allDecksNeed(reads: Reads, actor: Actor): Promise<CardNeed[]> {
  const toGet = await reads.decks.cardsToGet(actor);
  return toGet.cards.map((card) => ({ oracleId: card.oracleId, quantity: card.needed }));
}

/**
 * The cards one deck is short of, as game copies: a wish counts only those, so the real copies
 * a deck may use (design doc 16) come off what it needs. Null when it isn't your deck.
 */
async function deckNeeds(reads: Reads, actor: Actor, deckId: number): Promise<CardNeed[] | null> {
  const view = await reads.decks.deckView(actor, deckId);
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
