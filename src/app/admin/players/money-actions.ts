"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeCorrectBalanceError } from "@/modules/wallet";
import { Cents, UserId } from "@/shared/kernel";
import { readPage } from "@/server/page-instance";

export type MoneyActionState = { message: string | null; tone: "error" | "success" };

const MoneyForm = z.object({
  userId: z.string().min(1),
  intent: z.enum(["give", "take"]),
  amount: z.string(),
  note: z.string(),
});

/** Give money to a player, or take some away (a correction). */
export async function moneyAction(
  _previousState: MoneyActionState,
  formData: FormData,
): Promise<MoneyActionState> {
  const { actor: admin, capabilities } = await readPage({ admin: true });
  const form = MoneyForm.safeParse({
    userId: formData.get("userId"),
    intent: formData.get("intent"),
    amount: formData.get("amount"),
    note: formData.get("note"),
  });
  if (!form.success) return failure("Enter an amount and a note.");

  const amount = Cents.fromUsd(form.data.amount);
  if (amount === null) return failure("Enter an amount like 12.50.");

  const input = { userId: UserId.of(form.data.userId), amount, note: form.data.note };
  const { wallet } = capabilities;
  const result =
    form.data.intent === "give"
      ? await wallet.grantMoney(admin, input)
      : await wallet.correctBalance(admin, input);
  if (!result.ok) return failure(describeCorrectBalanceError(result.error));

  revalidatePath("/admin/players");
  const verb = form.data.intent === "give" ? "Gave" : "Took away";
  return { message: `${verb} ${Cents.format(amount)}.`, tone: "success" };
}

function failure(message: string): MoneyActionState {
  return { message, tone: "error" };
}

// CorrectBalanceError includes every GrantMoneyError, so one function covers both.
