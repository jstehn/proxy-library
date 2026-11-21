"use server";
import { z } from "zod";
import { describeAddOwnFundsError, type AddOwnFundsError } from "@/modules/wallet";
import { Cents, err, ok } from "@/shared/kernel";
import { formAction } from "@/server/form-action-instance";
import { revalidateHeader } from "@/app/paths";

const AddFundsForm = z.object({ amount: z.string(), note: z.string().default("") });

type AddFundsFailure = AddOwnFundsError | Readonly<{ kind: "AmountUnreadable" }>;

export const addFundsAction = formAction(
  AddFundsForm,
  async ({ actor, capabilities }, form) => {
    const amount = Cents.fromUsd(form.amount);
    if (amount === null) return err<AddFundsFailure>({ kind: "AmountUnreadable" });

    const result = await capabilities.wallet.addOwnFunds(actor, { amount, note: form.note });
    if (!result.ok) return result;

    revalidateHeader(); // the balance in the header changes too
    return ok(amount);
  },
  {
    invalidInput: "Enter an amount.",
    describeError: (error: AddFundsFailure) =>
      error.kind === "AmountUnreadable"
        ? "Enter an amount like 12.50."
        : describeAddOwnFundsError(error),
    successMessage: (amount) => `Added ${Cents.format(amount)}.`,
  },
);
