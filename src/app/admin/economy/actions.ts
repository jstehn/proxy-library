"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  describeUpdateEconomySettingsError,
  type UpdateEconomySettingsError,
} from "@/modules/wallet";
import { Cents, err } from "@/shared/kernel";
import { formAction } from "@/server/form-action-instance";

const EconomyForm = z.object({
  allowance: z.string(),
  allowancePeriodDays: z.coerce.number(),
  anchorIso: z.iso.datetime(), // the chosen payday, converted to an exact instant by the browser
  startingGrant: z.string(),
  selfFundLimit: z.string(),
});

type EconomyFailure = UpdateEconomySettingsError | Readonly<{ kind: "AmountsUnreadable" }>;

export const updateEconomyAction = formAction(
  EconomyForm,
  async ({ actor: admin, capabilities }, form) => {
    const allowance = Cents.fromUsd(form.allowance);
    const startingGrant = Cents.fromUsd(form.startingGrant);
    const selfFundLimit = Cents.fromUsd(form.selfFundLimit);
    if (allowance === null || startingGrant === null || selfFundLimit === null) {
      return err<EconomyFailure>({ kind: "AmountsUnreadable" });
    }

    const result = await capabilities.wallet.updateEconomySettings(admin, {
      allowance,
      allowancePeriodDays: form.allowancePeriodDays,
      allowanceAnchor: new Date(form.anchorIso),
      startingGrant,
      selfFundLimit,
    });
    if (result.ok) revalidatePath("/", "layout");
    return result;
  },
  {
    admin: true,
    invalidInput: "Please fill in every field.",
    describeError: (error: EconomyFailure) =>
      error.kind === "AmountsUnreadable"
        ? "Enter amounts like 20.00."
        : describeUpdateEconomySettingsError(error),
    successMessage: "Saved. Changes apply from now on.",
  },
);
