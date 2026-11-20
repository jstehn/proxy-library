"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SealedProductId } from "@/modules/catalog";
import { describeBuySealedError } from "@/modules/store";
import { formAction } from "@/server/form-action-instance";

const BuyForm = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number(),
});

export const buySealedAction = formAction(
  BuyForm,
  async ({ actor, capabilities }, form) => {
    const result = await capabilities.store.buySealed(actor, {
      productId: SealedProductId.of(form.productId),
      quantity: form.quantity,
    });
    if (result.ok) revalidatePath("/", "layout"); // the balance in the header changes
    return result;
  },
  {
    invalidInput: "Choose how many to buy.",
    describeError: describeBuySealedError,
    successMessage: ({ items }) =>
      `Bought ${items.length === 1 ? "it" : `${items.length}`}. ${items.length === 1 ? "It's" : "They're"} waiting in your inventory.`,
  },
);
