"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResetPlayerError } from "@/modules/reset";
import { err, Cents } from "@/shared/kernel";
import { CONFIRMATION_WORD } from "./confirmation";
import { formAction } from "@/server/form-action-instance";

const StartOverForm = z.object({ confirmation: z.string() });

type StartOverFailure = ResetPlayerError | Readonly<{ kind: "NotConfirmed" }>;

/** A player resets their own account to how it was when new (design doc 12). */
export const startOverAction = formAction(
  StartOverForm,
  async ({ actor, capabilities }, form) => {
    if (form.confirmation.trim().toUpperCase() !== CONFIRMATION_WORD) {
      return err<StartOverFailure>({ kind: "NotConfirmed" });
    }
    const result = await capabilities.resetPlayer(actor, actor.userId);
    if (result.ok) revalidatePath("/", "layout"); // every page may show your cards or money
    return result;
  },
  {
    invalidInput: `Type ${CONFIRMATION_WORD} to confirm.`,
    describeError: (error: StartOverFailure) =>
      error.kind === "NotConfirmed"
        ? `Type ${CONFIRMATION_WORD} to confirm.`
        : "Your account couldn't be reset. Please try again.",
    successMessage: ({ balance }) =>
      `Done. Your library is empty and your balance is ${Cents.format(balance)}.`,
  },
);
