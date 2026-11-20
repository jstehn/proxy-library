import { z } from "zod";
import { err, FinishOrCheapestSchema, ok } from "@/shared/kernel";
import {
  MAX_NOTE_LENGTH,
  MAX_WISH_QUANTITY,
  type AddWishesReport,
  type WishlistView,
} from "@/modules/wishlist";
import { defineBinding } from "../binding";
import { presentWishlist } from "../present/wishlist";

const wishId = z.number().int().positive().describe("The wish's id, from get_wishlist.");
const quantity = z
  .number()
  .int()
  .min(1)
  .max(MAX_WISH_QUANTITY)
  .describe("How many copies you want to own in total.");

type Failure = Readonly<{ kind: "InvalidInput"; message: string }>;

type Answer =
  | Readonly<{ action: "list"; view: WishlistView }>
  | Readonly<{ action: "add"; report: AddWishesReport }>
  | Readonly<{ action: "remove"; removed: number[]; notFound: number[] }>;

export const manageWishlistBinding = defineBinding({
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
          targetPriceCents: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Optional: flag the wish when a copy is at or below this price, in cents."),
          note: z
            .string()
            .max(MAX_NOTE_LENGTH)
            .default("")
            .describe("Optional note: which deck it's for, say."),
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
  async call(capabilities, actor, input) {
    if (input.action === "list") {
      const view = await capabilities.wishlistView(actor);
      return view.ok ? ok<Answer>({ action: "list", view: view.value }) : view;
    }
    if (input.action === "add") {
      if (!input.wishes || input.wishes.length === 0) {
        return err<Failure>({
          kind: "InvalidInput",
          message: "Provide at least 1 item in `wishes` for action='add'.",
        });
      }
      const report = await capabilities.addWishes({ actor, wishes: input.wishes });
      return report.ok ? ok<Answer>({ action: "add", report: report.value }) : report;
    }
    if (!input.wishIds || input.wishIds.length === 0) {
      return err<Failure>({
        kind: "InvalidInput",
        message: "Provide at least 1 id in `wishIds` for action='remove'.",
      });
    }
    const report = await capabilities.removeWishes({ actor, wishIds: input.wishIds });
    return report.ok ? ok<Answer>({ action: "remove", ...report.value }) : report;
  },
  present: (answer) =>
    answer.action === "list"
      ? presentWishlist(answer.view)
      : answer.action === "add"
        ? answer.report
        : { removed: answer.removed, notFound: answer.notFound },
  describeError: (failure) => ({ kind: failure.kind, message: failure.message }),
});
