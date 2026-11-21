"use server";
import { z } from "zod";
import { describeSetPlayerEmailError } from "@/modules/accounts";
import { UserId } from "@/shared/kernel";
import { formAction } from "@/server/form-action-instance";

const EmailForm = z.object({ userId: z.string().min(1), email: z.string() });

/**
 * An admin sets a player's real email, verified on their say-so (design doc 69, section 4.2). The
 * player's first Authentik sign-in then links to them when Authentik's email matches.
 */
export const setPlayerEmailAction = formAction(
  EmailForm,
  ({ actor: admin, capabilities }, form) =>
    capabilities.accounts.setPlayerEmail(admin, {
      userId: UserId.of(form.userId),
      email: form.email,
    }),
  {
    admin: true,
    invalidInput: "That action wasn't understood.",
    describeError: describeSetPlayerEmailError,
    successMessage: "Email saved.",
  },
);
