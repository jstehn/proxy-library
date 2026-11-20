"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import { describeBuySingleError, describeSellSingleError } from "@/modules/store";
import { readPage } from "@/server/page-instance";
import { Cents, FinishSchema } from "@/shared/kernel";

export type TradeState = { message: string | null; tone: "error" | "success" };

const SingleForm = z.object({
  printingId: z.string().min(1),
  finish: FinishSchema,
  quantity: z.coerce.number(),
});

function readForm(formData: FormData) {
  return SingleForm.safeParse({
    printingId: formData.get("printingId"),
    finish: formData.get("finish"),
    quantity: formData.get("quantity"),
  });
}

function refresh(printingId: string) {
  revalidatePath("/", "layout"); // the balance in the header
  revalidatePath(`/cards/${printingId}`);
}

export async function buySingleAction(
  _previous: TradeState,
  formData: FormData,
): Promise<TradeState> {
  const { actor, capabilities } = await readPage();
  const form = readForm(formData);
  if (!form.success) return { message: "Choose how many.", tone: "error" };
  const { printingId, finish, quantity } = form.data;

  const result = await capabilities.store.buySingle(actor, {
    printingId: PrintingId.of(printingId),
    finish,
    quantity,
  });
  if (!result.ok) return { message: describeBuySingleError(result.error), tone: "error" };
  refresh(printingId);
  return { message: `Bought for ${Cents.format(result.value.total)}.`, tone: "success" };
}

export async function sellSingleAction(
  _previous: TradeState,
  formData: FormData,
): Promise<TradeState> {
  const { actor, capabilities } = await readPage();
  const form = readForm(formData);
  if (!form.success) return { message: "Choose how many.", tone: "error" };
  const { printingId, finish, quantity } = form.data;

  const result = await capabilities.store.sellSingle(actor, {
    printingId: PrintingId.of(printingId),
    finish,
    quantity,
  });
  if (!result.ok) return { message: describeSellSingleError(result.error), tone: "error" };
  refresh(printingId);
  return { message: `Sold for ${Cents.format(result.value.total)}.`, tone: "success" };
}
