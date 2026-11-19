"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ResetPasswordError,
  SetAdminError,
  SetDisabledError,
  SetSelfFundingError,
  describePlayerActionError,
} from "@/modules/accounts";
import { assertNever, UserId, type Result } from "@/shared/kernel";
import { readPage } from "@/server/page-instance";

export type PlayerActionState = {
  message: string | null;
  tone: "error" | "success";
  temporaryPassword: string | null; // shown once, after a reset
};

// Each button on a player's row sends one of these "intents".
const PlayerActionForm = z.object({
  userId: z.string().min(1),
  intent: z.enum([
    "promote",
    "demote",
    "allow-self-funding",
    "stop-self-funding",
    "disable",
    "enable",
    "reset-password",
  ]),
});

type PlayerActionError =
  SetAdminError | SetSelfFundingError | SetDisabledError | ResetPasswordError;

export async function playerAction(
  _previousState: PlayerActionState,
  formData: FormData,
): Promise<PlayerActionState> {
  const { actor: admin, capabilities } = await readPage({ admin: true });
  const form = PlayerActionForm.safeParse({
    userId: formData.get("userId"),
    intent: formData.get("intent"),
  });
  if (!form.success) return failure("That action wasn't understood.");

  const { accounts } = capabilities;
  const userId = UserId.of(form.data.userId);

  let result: Result<unknown, PlayerActionError>;
  let temporaryPassword: string | null = null;
  switch (form.data.intent) {
    case "promote":
    case "demote":
      result = await accounts.setAdmin(admin, { userId, isAdmin: form.data.intent === "promote" });
      break;
    case "allow-self-funding":
    case "stop-self-funding":
      result = await accounts.setSelfFunding(admin, {
        userId,
        allowed: form.data.intent === "allow-self-funding",
      });
      break;
    case "disable":
    case "enable":
      result = await accounts.setDisabled(admin, {
        userId,
        disabled: form.data.intent === "disable",
      });
      break;
    case "reset-password": {
      const reset = await accounts.resetPassword(admin, { userId });
      if (reset.ok) temporaryPassword = reset.value.temporaryPassword;
      result = reset;
      break;
    }
    default:
      return assertNever(form.data.intent);
  }

  if (!result.ok) return failure(describePlayerActionError(result.error));
  revalidatePath("/admin/players");
  return { message: "Saved.", tone: "success", temporaryPassword };
}

function failure(message: string): PlayerActionState {
  return { message, tone: "error", temporaryPassword: null };
}
