"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AddOwnFundsError } from "@/modules/wallet";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents } from "@/shared/kernel";

export type AddFundsState = { message: string | null; tone: "error" | "success" };

const AddFundsForm = z.object({ amount: z.string(), note: z.string().default("") });

export async function addFundsAction(
  _previousState: AddFundsState,
  formData: FormData,
): Promise<AddFundsState> {
  const actor = await requireActor();
  const form = AddFundsForm.safeParse({
    amount: formData.get("amount"),
    note: formData.get("note") ?? undefined,
  });
  if (!form.success) return { message: "Enter an amount.", tone: "error" };

  const amount = Cents.fromUsd(form.data.amount);
  if (amount === null) return { message: "Enter an amount like 12.50.", tone: "error" };

  const result = await getContainer().wallet.addOwnFunds(actor, { amount, note: form.data.note });
  if (!result.ok) return { message: messageFor(result.error), tone: "error" };

  revalidatePath("/", "layout"); // the balance in the header changes too
  return { message: `Added ${Cents.format(amount)}.`, tone: "success" };
}

function messageFor(error: AddOwnFundsError): string {
  switch (error.kind) {
    case "SelfFundingNotAllowed":
      return "You don't have permission to add your own funds. Ask an admin.";
    case "AmountInvalid":
      return `Amount ${error.reason}.`;
    case "NoteInvalid":
      return `Note ${error.reason}.`;
    case "SelfFundLimitExceeded":
      return `You can add at most ${Cents.format(error.limit)} at a time.`;
    default:
      return assertNever(error);
  }
}
