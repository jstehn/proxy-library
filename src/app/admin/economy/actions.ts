"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { UpdateEconomySettingsError } from "@/modules/wallet";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { assertNever, Cents } from "@/shared/kernel";

export type EconomyFormState = { message: string | null; tone: "error" | "success" };

const EconomyForm = z.object({
  allowance: z.string(),
  allowancePeriodDays: z.coerce.number(),
  anchorIso: z.iso.datetime(), // the chosen payday, converted to an exact instant by the browser
  startingGrant: z.string(),
  selfFundLimit: z.string(),
});

export async function updateEconomyAction(
  _previousState: EconomyFormState,
  formData: FormData,
): Promise<EconomyFormState> {
  const admin = await requireAdminActor();
  const form = EconomyForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return failure("Please fill in every field.");

  const allowance = Cents.fromUsd(form.data.allowance);
  const startingGrant = Cents.fromUsd(form.data.startingGrant);
  const selfFundLimit = Cents.fromUsd(form.data.selfFundLimit);
  if (allowance === null || startingGrant === null || selfFundLimit === null) {
    return failure("Enter amounts like 20.00.");
  }

  const result = await getContainer().wallet.updateEconomySettings(admin, {
    allowance,
    allowancePeriodDays: form.data.allowancePeriodDays,
    allowanceAnchor: new Date(form.data.anchorIso),
    startingGrant,
    selfFundLimit,
  });
  if (!result.ok) return failure(messageFor(result.error));

  revalidatePath("/", "layout");
  return { message: "Saved. Changes apply from now on.", tone: "success" };
}

function failure(message: string): EconomyFormState {
  return { message, tone: "error" };
}

function messageFor(error: UpdateEconomySettingsError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can change the economy.";
    case "SettingsInvalid":
      return error.reason;
    default:
      return assertNever(error);
  }
}
