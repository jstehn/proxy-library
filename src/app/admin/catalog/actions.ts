"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SetCode, type SetSetEnabledError } from "@/modules/catalog";
import { assertNever } from "@/shared/kernel";
import { formAction } from "@/server/form-action-instance";
import { readPage } from "@/server/page-instance";

const SyncForm = z.object({ kind: z.enum(["prices", "full"]) });

export const requestSyncAction = formAction(
  SyncForm,
  async ({ actor: admin, capabilities }, form) => {
    const result = await capabilities.catalog.requestSync(admin, form.kind);
    revalidatePath("/admin/catalog");
    return result;
  },
  {
    admin: true,
    invalidInput: "Unknown kind of sync.",
    describeError: (error) =>
      error.kind === "Forbidden"
        ? "Only admins can start a sync."
        : "A sync is already queued or running.",
    successMessage: "Queued. The worker picks it up within 30 seconds (it must be running).",
  },
);

// It needs no form fields, so its schema is empty.
export const enableStandardSetsAction = formAction(
  z.object({}),
  async ({ actor: admin, capabilities }) => {
    const result = await capabilities.catalog.enableStandardSets(admin);
    revalidatePath("/admin/catalog");
    return result;
  },
  {
    admin: true,
    describeError: () => "Only admins can do that.",
    successMessage: (enabled) =>
      enabled.length === 0
        ? "Every current Standard set is already enabled."
        : `Enabled ${enabled.join(", ")}. A sync was queued.`,
  },
);

const SetForm = z.object({ code: z.string().min(1), enabled: z.enum(["true", "false"]) });

/** Enable/disable buttons in the sets list. No message: the list itself shows the new state. */
export async function setSetEnabledAction(formData: FormData): Promise<void> {
  const { actor: admin, capabilities } = await readPage({ admin: true });
  const form = SetForm.safeParse({ code: formData.get("code"), enabled: formData.get("enabled") });
  if (!form.success) return;
  const result = await capabilities.catalog.setSetEnabled(admin, {
    code: SetCode.of(form.data.code),
    enabled: form.data.enabled === "true",
  });
  if (!result.ok) console.warn("set enable:", setMessageFor(result.error));
  revalidatePath("/admin/catalog");
}

function setMessageFor(error: SetSetEnabledError): string {
  switch (error.kind) {
    case "Forbidden":
      return "not an admin";
    case "SetNotFound":
      return "no such set";
    default:
      return assertNever(error);
  }
}
