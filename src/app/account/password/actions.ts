"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { describeChangeOwnPasswordError } from "@/modules/accounts";
import { formAction } from "@/server/form-action-instance";
import { ok } from "@/shared/kernel";

// A player who must change their password (after an admin reset) can reach this form before any
// other page, so it allows the pending change.
export const changePasswordAction = formAction(
  z.object({ currentPassword: z.string(), newPassword: z.string() }),
  async ({ actor, capabilities }, input) => {
    const result = await capabilities.accounts.changeOwnPassword(actor, input, await headers());
    return result.ok ? ok({ wasForced: actor.mustChangePassword }) : result;
  },
  {
    allowPasswordChangePending: true,
    describeError: describeChangeOwnPasswordError,
    invalidInput: "Please fill in both fields.",
    successMessage: "Your password has been changed.",
    // After a forced change, carry on into the app.
    redirectTo: ({ wasForced }) => (wasForced ? "/" : undefined),
  },
);
