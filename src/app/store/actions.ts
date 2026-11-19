"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SealedProductId } from "@/modules/catalog";
import { describeBuySealedError } from "@/modules/store";
import { readPage } from "@/server/page-instance";

export type BuyState = { message: string | null; tone: "error" | "success" };

const BuyForm = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number(),
});

export async function buySealedAction(
  _previousState: BuyState,
  formData: FormData,
): Promise<BuyState> {
  const { actor, capabilities } = await readPage();
  const form = BuyForm.safeParse({
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });
  if (!form.success) return { message: "Choose how many to buy.", tone: "error" };

  const result = await capabilities.store.buySealed(actor, {
    productId: SealedProductId.of(form.data.productId),
    quantity: form.data.quantity,
  });
  if (!result.ok) return { message: describeBuySealedError(result.error), tone: "error" };

  revalidatePath("/", "layout"); // the balance in the header changes
  const count = result.value.items.length;
  return {
    message: `Bought ${count === 1 ? "it" : `${count}`}. ${count === 1 ? "It's" : "They're"} waiting in your inventory.`,
    tone: "success",
  };
}
