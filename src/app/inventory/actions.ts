"use server";
import { z } from "zod";
import { ItemId } from "@/modules/inventory";
import { formRedirect } from "@/server/form-action-instance";
import { finishOpening } from "./finish-opening";
import { inventoryErrorPath } from "./paths";

const OpenForm = z.object({
  itemIds: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((text) => text.split(",").map((id) => ItemId.of(Number(id)))),
  mode: z.enum(["one", "all"]),
});

/** Opens one item, or opens items and everything inside them, then shows what came out. */
export const openAction = formRedirect(
  OpenForm,
  async ({ actor, capabilities }, { itemIds, mode }) => {
    const { inventory } = capabilities;
    const [first] = itemIds;
    const result =
      mode === "one"
        ? await inventory.openItem(actor, first)
        : await inventory.openAll(actor, itemIds);
    if (!result.ok) return inventoryErrorPath(result.error.kind);

    const openings = Array.isArray(result.value) ? result.value : [result.value];
    return finishOpening(actor, capabilities, openings);
  },
  { unreadable: inventoryErrorPath("ItemNotFound") },
);
