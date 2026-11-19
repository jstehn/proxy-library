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
import { Cents, FinishOrCheapestSchema } from "@/shared/kernel";
import { defineTool, done, failed, type ToolContext } from "../tool";

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

function compactLineView(line: WishLine) {
  return {
    wishId: line.wish.id,
    name: line.name,
    quantity: line.wish.quantity,
    owned: line.owned,
    missing: line.missing,
    bestPriceCents: line.offer === null ? null : Math.round(line.offer.price),
    totalForMissingCents: line.total === null ? null : Math.round(line.total),
    targetPriceCents: line.wish.targetPrice === null ? null : Math.round(line.wish.targetPrice),
    atTarget: line.atTarget,
    status:
      line.status.kind === "shortBy"
        ? `shortBy:${Math.round(line.status.shortfall)}c/${line.status.paydays}p`
        : line.status.kind,
    ...(line.wish.note ? { note: line.wish.note } : {}),
  };
}

export async function compactWishlistPayload(context: ToolContext) {
  const { db, clock, wallet } = context.container;
  const userId = context.actor.userId;
  const [answers, balance, settings] = await Promise.all([
    wishlistAnswers(db, userId),
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
  return {
    balanceCents: Math.round(balance),
    totalForMissingCents: Math.round(sum.all),
    wishes: lines.map(compactLineView),
  };
}

export const manageWishlist = defineTool({
  name: "manage_wishlist",
  title: "Manage wishlist",
  description:
    "List, add/update, or remove cards on your wishlist. Use action 'list' (default), 'add' (with wishes), or 'remove' (with wishIds).",
  scope: "wishlist:write",
  readOnly: false,
  input: z.object({
    action: z
      .enum(["list", "add", "remove"])
      .default("list")
      .describe("Action: 'list', 'add' (upserts by card), or 'remove' (by wishIds)."),
    wishes: z
      .array(
        z.object({
          card: z.string().min(1).describe("Card name or printing id."),
          printing: z.enum(["any", "exact"]).default("any").describe("'any' or 'exact' printing."),
          finish: FinishOrCheapestSchema.default("nonfoil").describe(
            "Finish ('cheapest' only with 'any'; 'etched' only with 'exact').",
          ),
          quantity: quantity.default(1),
          targetPriceCents,
          note,
        }),
      )
      .max(50)
      .optional()
      .describe("Cards to add/update (for action='add')."),
    wishIds: z
      .array(wishId)
      .max(50)
      .optional()
      .describe("Wish ids to remove (for action='remove')."),
  }),
  async run(context, input) {
    if (input.action === "list") {
      return done(await compactWishlistPayload(context));
    }
    if (input.action === "add") {
      if (!input.wishes || input.wishes.length === 0) {
        return failed("InvalidInput", "Provide at least 1 item in `wishes` for action='add'.");
      }
      return addWish.run(context, { wishes: input.wishes });
    }
    if (!input.wishIds || input.wishIds.length === 0) {
      return failed("InvalidInput", "Provide at least 1 id in `wishIds` for action='remove'.");
    }
    return removeWish.run(context, { wishIds: input.wishIds });
  },
});

const addWish = defineTool({
  name: "add_wishes",
  title: "Add cards to my wishlist",
  description: [
    "Saves 1 to 50 cards the player wants but doesn't buy now. Wishing for the same card again updates that wish.",
    'Use it when: saving store cards the player wants to buy later. "any" printing means the cheapest for sale; "exact" means one printing (give its printingId from get_cards).',
  ].join("\n"),
  scope: "wishlist:write",
  readOnly: false,
  input: z.object({
    wishes: z
      .array(
        z.object({
          card: z.string().min(1).describe("The card's exact English name, or a printing id."),
          printing: z
            .enum(["any", "exact"])
            .default("any")
            .describe(
              '"any": the cheapest printing for sale; "exact": the printing named by card.',
            ),
          finish: FinishOrCheapestSchema.default("nonfoil").describe(
            'The finish. "cheapest" only with "any"; "etched" only with "exact".',
          ),
          quantity: quantity.default(1),
          targetPriceCents,
          note,
        }),
      )
      .min(1)
      .max(50)
      .describe("1 to 50 cards to add or update on the wishlist."),
  }),
  async run(context, input) {
    const added: { wishId: number; card: string; isNew: boolean }[] = [];
    const errors: { card: string; kind: string; message: string }[] = [];
    for (const item of input.wishes) {
      const found = await findCard(context.container.db, item.card);
      if (found === null) {
        errors.push({ card: item.card, kind: "CardNotFound", message: "Not in catalog." });
        continue;
      }
      let request: WishRequest;
      if (item.printing === "any") {
        if (item.finish === "etched") {
          errors.push({
            card: item.card,
            kind: "InvalidWish",
            message: 'For "any" printing, finish must be nonfoil, foil, or cheapest.',
          });
          continue;
        }
        request = { kind: "anyPrinting", printingId: found.printingId, finish: item.finish };
      } else {
        if (item.finish === "cheapest") {
          errors.push({
            card: item.card,
            kind: "InvalidWish",
            message: 'For an "exact" printing, finish must be nonfoil, foil, or etched.',
          });
          continue;
        }
        request = { kind: "exactPrinting", printingId: found.printingId, finish: item.finish };
      }
      const result = await context.container.wishlist.addWish(context.actor, {
        request,
        details: {
          quantity: item.quantity,
          targetPrice: item.targetPriceCents === undefined ? null : Cents.of(item.targetPriceCents),
          note: item.note,
        },
      });
      if (!result.ok) {
        const message =
          result.error.kind === "FinishNotAvailable"
            ? `Available finishes: ${result.error.finishes.join(", ")}.`
            : result.error.kind === "WishlistFull"
              ? `The wishlist holds at most ${result.error.max} wishes.`
              : result.error.kind === "InvalidWish"
                ? result.error.reason
                : "Card not found.";
        errors.push({ card: item.card, kind: result.error.kind, message });
        continue;
      }
      added.push({ wishId: result.value.wish.id, card: found.name, isNew: result.value.isNew });
    }
    return done({ added, errors });
  },
});

const removeWish = defineTool({
  name: "remove_wishes",
  title: "Remove wishes",
  description:
    "Takes 1 to 50 wishes off the wishlist by their ids from get_wishlist. Buying a wished card in the web app removes its wish automatically.",
  scope: "wishlist:write",
  readOnly: false,
  input: z.object({
    wishIds: z.array(wishId).min(1).max(50).describe("1 to 50 wish ids from get_wishlist."),
  }),
  async run(context, input) {
    const removed: number[] = [];
    const notFound: number[] = [];
    for (const id of input.wishIds) {
      const result = await context.container.wishlist.removeWish(context.actor, WishId.of(id));
      if (result.ok) removed.push(id);
      else notFound.push(id);
    }
    return done({ removed, notFound });
  },
});
