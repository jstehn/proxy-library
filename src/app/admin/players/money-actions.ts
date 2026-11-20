"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeCorrectBalanceError, type CorrectBalanceError } from "@/modules/wallet";
import { Cents, UserId, err, ok } from "@/shared/kernel";
import { formAction } from "@/server/form-action-instance";

const MoneyForm = z.object({
  userId: z.string().min(1),
  intent: z.enum(["give", "take"]),
  amount: z.string(),
  note: z.string(),
});

// CorrectBalanceError includes every GrantMoneyError, so one function covers both.
type MoneyFailure = CorrectBalanceError | Readonly<{ kind: "AmountUnreadable" }>;

/** Give money to a player, or take some away (a correction). */
export const moneyAction = formAction(
  MoneyForm,
  async ({ actor: admin, capabilities }, form) => {
    const amount = Cents.fromUsd(form.amount);
    if (amount === null) return err<MoneyFailure>({ kind: "AmountUnreadable" });

    const input = { userId: UserId.of(form.userId), amount, note: form.note };
    const { wallet } = capabilities;
    const result =
      form.intent === "give"
        ? await wallet.grantMoney(admin, input)
        : await wallet.correctBalance(admin, input);
    if (!result.ok) return result;

    revalidatePath("/admin/players");
    return ok(`${form.intent === "give" ? "Gave" : "Took away"} ${Cents.format(amount)}.`);
  },
  {
    admin: true,
    invalidInput: "Enter an amount and a note.",
    describeError: (error: MoneyFailure) =>
      error.kind === "AmountUnreadable"
        ? "Enter an amount like 12.50."
        : describeCorrectBalanceError(error),
    successMessage: (message) => message,
  },
);
