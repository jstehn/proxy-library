import { z } from "zod";
import { findCard } from "@/modules/decks";
import { currentEconomySettings, nextPayday } from "@/modules/wallet";
import {
  MAX_NOTE_LENGTH,
  MAX_WISH_QUANTITY,
  totals,
  WishId,
  wishLines,
  wishlistAnswers,
  type WishLine,
  type WishRequest,
} from "@/modules/wishlist";
import { Cents } from "@/shared/kernel";
import { cardNotFound, defineTool, done, failed, money, moneyOrNull } from "../tool";

// The wishlist (design doc 28, section 5.2; design doc 26). Saving a wish costs nothing; buying
// stays in the web app (decision 2).

const wishId = z.number().int().positive().describe("The wish's id, from get_wishlist.");
const quantity = z
  .number()
  .int()
  .min(1)
  .max(MAX_WISH_QUANTITY)
  .describe("How many copies you want to own in total.");
const targetPriceCents = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Optional: flag the wish when a copy is at or below this price, in cents.");
const note = z
  .string()
  .max(MAX_NOTE_LENGTH)
  .default("")
  .describe("Optional note: which deck it's for, say.");

function lineView(line: WishLine) {
  return {
    wishId: line.wish.id,
    name: line.name,
    quantity: line.wish.quantity,
    owned: line.owned,
    missing: line.missing,
    target:
      line.wish.target.kind === "anyPrinting"
        ? { printing: "any", finish: line.wish.target.finish }
        : { printing: line.wish.target.printingId, finish: line.wish.target.finish },
    bestOffer:
      line.offer === null
        ? null
        : {
            printingId: line.offer.printingId,
            set: line.offer.setCode,
            number: line.offer.collectorNumber,
            finish: line.offer.finish,
            price: money(line.offer.price),
          },
    totalForMissing: moneyOrNull(line.total),
    changeSinceSaved: moneyOrNull(line.changeSinceSaved),
    targetPrice: moneyOrNull(line.wish.targetPrice),
    atTarget: line.atTarget,
    status:
      line.status.kind === "shortBy"
        ? { kind: "shortBy", shortfall: money(line.status.shortfall), paydays: line.status.paydays }
        : { kind: line.status.kind },
    note: line.wish.note,
  };
}

export const getWishlist = defineTool({
  name: "get_wishlist",
  title: "My wishlist",
  description: [
    "Your wishlist: each wish at today's best price, how it moved since you saved it, whether your balance covers it (or how many paydays until it does), and wishes at their target price.",
    "Use it when: planning what to buy, or before add_wish (a wish for the same card is updated, not doubled).",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({}),
  async run(context) {
    const { db, clock, wallet } = context.container;
    const userId = context.actor.userId;
    const [answers, balance, settings] = await Promise.all([
      wishlistAnswers(db, userId),
      // Brings the wallet up to date (a due allowance is paid), as the Wishlist page does.
      wallet.refreshWallet(userId),
      currentEconomySettings(db),
    ]);
    const lines = wishLines(answers, {
      balance,
      allowance: settings.allowance,
      allowancePeriodDays: settings.allowancePeriodDays,
      nextPayday: nextPayday(
        { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
        clock.now(),
      ),
    });
    const sum = totals(lines);
    return done({
      balance: money(balance),
      totalForMissing: money(sum.all),
      wishes: lines.map(lineView),
    });
  },
});

export const addWish = defineTool({
  name: "add_wish",
  title: "Add a card to my wishlist",
  description: [
    "Saves a card the player wants but doesn't buy now. Wishing for the same card again updates that wish.",
    'Use it when: recommending store cards the player can\'t or won\'t buy yet. "any" printing means the cheapest printing for sale; "exact" means one printing (give its printingId from get_card).',
    "Rules: nothing is bought; the player buys from the Wishlist page.",
  ].join("\n"),
  scope: "wishlist:write",
  readOnly: false,
  input: z.object({
    card: z.string().min(1).describe("The card's exact English name, or a printing id."),
    printing: z
      .enum(["any", "exact"])
      .default("any")
      .describe('"any": the cheapest printing for sale; "exact": the printing named by card.'),
    finish: z
      .enum(["nonfoil", "foil", "etched", "cheapest"])
      .default("nonfoil")
      .describe(
        'The finish. "cheapest" (either finish) only with printing "any"; "etched" only with "exact".',
      ),
    quantity: quantity.default(1),
    targetPriceCents,
    note,
  }),
  async run(context, input) {
    const found = await findCard(context.container.db, input.card);
    if (found === null) return cardNotFound(input.card);
    let request: WishRequest;
    if (input.printing === "any") {
      if (input.finish === "etched") {
        return failed(
          "InvalidWish",
          'For "any" printing, the finish is nonfoil, foil or cheapest.',
        );
      }
      request = { kind: "anyPrinting", printingId: found.printingId, finish: input.finish };
    } else {
      if (input.finish === "cheapest") {
        return failed(
          "InvalidWish",
          'For an "exact" printing, the finish is nonfoil, foil or etched.',
        );
      }
      request = { kind: "exactPrinting", printingId: found.printingId, finish: input.finish };
    }
    const result = await context.container.wishlist.addWish(context.actor, {
      request,
      details: {
        quantity: input.quantity,
        targetPrice: input.targetPriceCents === undefined ? null : Cents.of(input.targetPriceCents),
        note: input.note,
      },
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "InvalidWish":
          return failed("InvalidWish", result.error.reason);
        case "CardNotFound":
          return cardNotFound(input.card);
        case "FinishNotAvailable":
          return failed(
            "FinishNotAvailable",
            `That printing comes in: ${result.error.finishes.join(", ")}.`,
          );
        case "WishlistFull":
          return failed("WishlistFull", `The wishlist holds at most ${result.error.max} wishes.`);
      }
    }
    return done({ wishId: result.value.wish.id, card: found.name, isNew: result.value.isNew });
  },
});

export const updateWish = defineTool({
  name: "update_wish",
  title: "Change a wish",
  description:
    "Changes how many copies a wish wants, its target price, or its note, by its id from get_wishlist. Send all three: what you leave out is cleared.",
  scope: "wishlist:write",
  readOnly: false,
  input: z.object({ wishId, quantity, targetPriceCents, note }),
  async run(context, input) {
    const result = await context.container.wishlist.updateWish(
      context.actor,
      WishId.of(input.wishId),
      {
        quantity: input.quantity,
        targetPrice: input.targetPriceCents === undefined ? null : Cents.of(input.targetPriceCents),
        note: input.note,
      },
    );
    if (!result.ok) {
      return result.error.kind === "WishNotFound"
        ? failed("WishNotFound", `Wish ${input.wishId} isn't on your wishlist. Call get_wishlist.`)
        : failed("InvalidWish", result.error.reason);
    }
    return done({ wishId: input.wishId, updated: true });
  },
});

export const removeWish = defineTool({
  name: "remove_wish",
  title: "Remove a wish",
  description:
    "Takes a wish off the wishlist, by its id from get_wishlist. Buying a wished card in the web app removes the wish by itself.",
  scope: "wishlist:write",
  readOnly: false,
  input: z.object({ wishId }),
  async run(context, input) {
    const result = await context.container.wishlist.removeWish(
      context.actor,
      WishId.of(input.wishId),
    );
    if (!result.ok) {
      return failed(
        "WishNotFound",
        `Wish ${input.wishId} isn't on your wishlist. Call get_wishlist.`,
      );
    }
    return done({ wishId: input.wishId, removed: true });
  },
});
