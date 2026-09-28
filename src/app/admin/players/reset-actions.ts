"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { assertNever, Cents, UserId } from "@/shared/kernel";

export type ResetActionState = { message: string | null; tone: "error" | "success" };

const ResetForm = z.object({
  userId: z.string().min(1),
  username: z.string(),
  confirmation: z.string(),
});

/** Empty a player's library (design doc 12), once the admin has typed the username to confirm. */
export async function resetLibraryAction(
  _previousState: ResetActionState,
  formData: FormData,
): Promise<ResetActionState> {
  const admin = await requireAdminActor();
  const form = ResetForm.safeParse({
    userId: formData.get("userId"),
    username: formData.get("username"),
    confirmation: formData.get("confirmation"),
  });
  if (!form.success) return failure("That action wasn't understood.");
  if (form.data.confirmation.trim().toLowerCase() !== form.data.username.toLowerCase()) {
    return failure(`Type ${form.data.username} to confirm.`);
  }

  const { resetPlayer } = getContainer();
  const result = await resetPlayer(admin, UserId.of(form.data.userId));
  if (!result.ok) {
    switch (result.error.kind) {
      case "Forbidden":
        return failure("Only admins can reset players.");
      case "PlayerNotFound":
        return failure("That player doesn't exist.");
      default:
        return assertNever(result.error);
    }
  }

  revalidatePath("/", "layout"); // every page may show this player's cards or money
  const summary = result.value;
  return {
    message:
      `Reset: ${summary.copiesRemoved} cards, ${summary.itemsRemoved} sealed items and ` +
      `${summary.decksDeleted} decks removed, ${summary.tradesClosed} open trades closed. ` +
      `Balance is now ${Cents.format(summary.balance)}.`,
    tone: "success",
  };
}

function failure(message: string): ResetActionState {
  return { message, tone: "error" };
}
