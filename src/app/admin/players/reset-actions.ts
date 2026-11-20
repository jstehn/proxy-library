"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResetPlayerError } from "@/modules/reset";
import { assertNever, Cents, UserId, err } from "@/shared/kernel";
import { formAction } from "@/server/form-action-instance";

const ResetForm = z.object({
  userId: z.string().min(1),
  username: z.string(),
  confirmation: z.string(),
});

type ResetFailure = ResetPlayerError | Readonly<{ kind: "NotConfirmed"; username: string }>;

function describeResetFailure(error: ResetFailure): string {
  switch (error.kind) {
    case "NotConfirmed":
      return `Type ${error.username} to confirm.`;
    case "Forbidden":
      return "Only admins can reset players.";
    case "PlayerNotFound":
      return "That player doesn't exist.";
    default:
      return assertNever(error);
  }
}

/** Empty a player's library (design doc 12), once the admin has typed the username to confirm. */
export const resetLibraryAction = formAction(
  ResetForm,
  async ({ actor: admin, capabilities }, form) => {
    if (form.confirmation.trim().toLowerCase() !== form.username.toLowerCase()) {
      return err<ResetFailure>({ kind: "NotConfirmed", username: form.username });
    }
    const result = await capabilities.resetPlayer(admin, UserId.of(form.userId));
    if (result.ok) revalidatePath("/", "layout"); // every page may show this player's cards or money
    return result;
  },
  {
    admin: true,
    invalidInput: "That action wasn't understood.",
    describeError: describeResetFailure,
    successMessage: (summary) =>
      `Reset: ${summary.copiesRemoved} cards, ${summary.itemsRemoved} sealed items and ` +
      `${summary.decksDeleted} decks and ${summary.wishesDeleted} wishes removed, ` +
      `${summary.tradesClosed} open trades closed` +
      (summary.lobbiesLeft > 0 ? `, ${summary.lobbiesLeft} draft lobbies left. ` : ". ") +
      `Balance is now ${Cents.format(summary.balance)}.`,
  },
);
