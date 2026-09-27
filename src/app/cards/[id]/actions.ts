"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import type { BuySingleError, SellSingleError } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents } from "@/shared/kernel";

export type TradeState = { message: string | null; tone: "error" | "success" };

const SingleForm = z.object({
  printingId: z.string().min(1),
  finish: z.enum(["nonfoil", "foil", "etched"]),
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
  const actor = await requireActor();
  const form = readForm(formData);
  if (!form.success) return { message: "Choose how many.", tone: "error" };
  const { printingId, finish, quantity } = form.data;

  const result = await getContainer().store.buySingle(actor, {
    printingId: PrintingId.of(printingId),
    finish,
    quantity,
  });
  if (!result.ok) return { message: buyMessage(result.error), tone: "error" };
  refresh(printingId);
  return { message: `Bought for ${Cents.format(result.value.total)}.`, tone: "success" };
}

export async function sellSingleAction(
  _previous: TradeState,
  formData: FormData,
): Promise<TradeState> {
  const actor = await requireActor();
  const form = readForm(formData);
  if (!form.success) return { message: "Choose how many.", tone: "error" };
  const { printingId, finish, quantity } = form.data;

  const result = await getContainer().store.sellSingle(actor, {
    printingId: PrintingId.of(printingId),
    finish,
    quantity,
  });
  if (!result.ok) return { message: sellMessage(result.error), tone: "error" };
  refresh(printingId);
  return { message: `Sold for ${Cents.format(result.value.total)}.`, tone: "success" };
}

function buyMessage(error: BuySingleError): string {
  switch (error.kind) {
    case "NotForSale":
      return "This card's set isn't in the store.";
    case "NoPrice":
      return "There's no market price for this finish, so the store can't sell it.";
    case "QuantityInvalid":
      return `You can buy 1 to ${error.max} at a time.`;
    case "InsufficientFunds":
      return `Not enough money: you have ${Cents.format(error.balance)} and this costs ${Cents.format(error.required)}.`;
    default:
      return assertNever(error);
  }
}

function sellMessage(error: SellSingleError): string {
  switch (error.kind) {
    case "NoPrice":
      return "There's no market price for this finish, so the store can't buy it.";
    case "QuantityInvalid":
      return `You can sell 1 to ${error.max} at a time.`;
    case "NotEnoughCopies":
      return `You only have ${error.owned}.`;
    case "WorthNothing":
      return "The store would pay less than a cent for this card.";
    case "NotBuying":
      return "The store isn't buying cards right now.";
    default:
      return assertNever(error);
  }
}
