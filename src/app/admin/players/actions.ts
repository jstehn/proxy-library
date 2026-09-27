"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  ResetPasswordError,
  SetAdminError,
  SetDisabledError,
  SetSelfFundingError,
} from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { assertNever, UserId, type Result } from "@/shared/kernel";

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
  const admin = await requireAdminActor();
  const form = PlayerActionForm.safeParse({
    userId: formData.get("userId"),
    intent: formData.get("intent"),
  });
  if (!form.success) return failure("That action wasn't understood.");

  const { accounts } = getContainer();
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

  if (!result.ok) return failure(messageFor(result.error));
  revalidatePath("/admin/players");
  return { message: "Saved.", tone: "success", temporaryPassword };
}

function failure(message: string): PlayerActionState {
  return { message, tone: "error", temporaryPassword: null };
}

function messageFor(error: PlayerActionError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can do that.";
    case "PlayerNotFound":
      return "That player no longer exists.";
    case "LastAdmin":
      return "There must always be at least one active admin. Promote someone else first.";
    case "CannotDisableSelf":
      return "You can't disable your own account. Ask another admin.";
    default:
      return assertNever(error);
  }
}
