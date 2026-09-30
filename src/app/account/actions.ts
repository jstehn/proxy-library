"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents } from "@/shared/kernel";
import { CONFIRMATION_WORD } from "./confirmation";

export type StartOverState = { message: string | null; tone: "error" | "success" };

const StartOverForm = z.object({ confirmation: z.string() });

/** A player resets their own account to how it was when new (design doc 12). */
export async function startOverAction(
  _previousState: StartOverState,
  formData: FormData,
): Promise<StartOverState> {
  const actor = await requireActor();
  const form = StartOverForm.safeParse({ confirmation: formData.get("confirmation") });
  if (!form.success || form.data.confirmation.trim().toUpperCase() !== CONFIRMATION_WORD) {
    return { message: `Type ${CONFIRMATION_WORD} to confirm.`, tone: "error" };
  }

  const { resetPlayer } = getContainer();
  const result = await resetPlayer(actor, actor.userId);
  if (!result.ok) {
    switch (result.error.kind) {
      case "Forbidden":
      case "PlayerNotFound":
        return { message: "Your account couldn't be reset. Please try again.", tone: "error" };
      default:
        return assertNever(result.error);
    }
  }

  revalidatePath("/", "layout"); // every page may show your cards or money
  return {
    message: `Done. Your library is empty and your balance is ${Cents.format(result.value.balance)}.`,
    tone: "success",
  };
}
