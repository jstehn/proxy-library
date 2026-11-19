"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeAddOwnFundsError } from "@/modules/wallet";
import { Cents } from "@/shared/kernel";
import { readPage } from "@/server/page-instance";

export type AddFundsState = { message: string | null; tone: "error" | "success" };

const AddFundsForm = z.object({ amount: z.string(), note: z.string().default("") });

export async function addFundsAction(
  _previousState: AddFundsState,
  formData: FormData,
): Promise<AddFundsState> {
  const { actor, capabilities } = await readPage();
  const form = AddFundsForm.safeParse({
    amount: formData.get("amount"),
    note: formData.get("note") ?? undefined,
  });
  if (!form.success) return { message: "Enter an amount.", tone: "error" };

  const amount = Cents.fromUsd(form.data.amount);
  if (amount === null) return { message: "Enter an amount like 12.50.", tone: "error" };

  const result = await capabilities.wallet.addOwnFunds(actor, { amount, note: form.data.note });
  if (!result.ok) return { message: describeAddOwnFundsError(result.error), tone: "error" };

  revalidatePath("/", "layout"); // the balance in the header changes too
  return { message: `Added ${Cents.format(amount)}.`, tone: "success" };
}
