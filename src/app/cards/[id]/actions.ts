"use server";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import { describeBuySingleError, describeSellSingleError } from "@/modules/store";
import { formAction } from "@/server/form-action-instance";
import { Cents, FinishSchema } from "@/shared/kernel";
import { revalidateCardAndHeader } from "../paths";

const SingleForm = z.object({
  printingId: z.string().min(1),
  finish: FinishSchema,
  quantity: z.coerce.number(),
});

export const buySingleAction = formAction(
  SingleForm,
  async ({ actor, capabilities }, form) => {
    const result = await capabilities.store.buySingle(actor, {
      ...form,
      printingId: PrintingId.of(form.printingId),
    });
    if (result.ok) revalidateCardAndHeader(form.printingId);
    return result;
  },
  {
    invalidInput: "Choose how many.",
    describeError: describeBuySingleError,
    successMessage: ({ total }) => `Bought for ${Cents.format(total)}.`,
  },
);

export const sellSingleAction = formAction(
  SingleForm,
  async ({ actor, capabilities }, form) => {
    const result = await capabilities.store.sellSingle(actor, {
      ...form,
      printingId: PrintingId.of(form.printingId),
    });
    if (result.ok) revalidateCardAndHeader(form.printingId);
    return result;
  },
  {
    invalidInput: "Choose how many.",
    describeError: describeSellSingleError,
    successMessage: ({ total }) => `Sold for ${Cents.format(total)}.`,
  },
);
