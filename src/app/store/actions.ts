"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SealedProductId } from "@/modules/catalog";
import type { BuySealedError } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents } from "@/shared/kernel";

export type BuyState = { message: string | null; tone: "error" | "success" };

const BuyForm = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number(),
});

export async function buySealedAction(
  _previousState: BuyState,
  formData: FormData,
): Promise<BuyState> {
  const actor = await requireActor();
  const form = BuyForm.safeParse({
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });
  if (!form.success) return { message: "Choose how many to buy.", tone: "error" };

  const result = await getContainer().store.buySealed(actor, {
    productId: SealedProductId.of(form.data.productId),
    quantity: form.data.quantity,
  });
  if (!result.ok) return { message: messageFor(result.error), tone: "error" };

  revalidatePath("/", "layout"); // the balance in the header changes
  const count = result.value.items.length;
  return {
    message: `Bought ${count === 1 ? "it" : `${count}`}. ${count === 1 ? "It's" : "They're"} waiting in your inventory.`,
    tone: "success",
  };
}

function messageFor(error: BuySealedError): string {
  switch (error.kind) {
    case "ProductNotForSale":
      return "That product isn't for sale.";
    case "QuantityInvalid":
      return `You can buy 1 to ${error.max} at a time.`;
    case "InsufficientFunds":
      return `Not enough money: you have ${Cents.format(error.balance)} and this costs ${Cents.format(error.required)}.`;
    default:
      return assertNever(error);
  }
}
