"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SetCode, type RequestSyncError, type SetSetEnabledError } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { assertNever } from "@/shared/kernel";

export type CatalogActionState = { message: string | null; tone: "error" | "success" };

const SyncForm = z.object({ kind: z.enum(["prices", "full"]) });

export async function requestSyncAction(
  _previousState: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const admin = await requireAdminActor();
  const form = SyncForm.safeParse({ kind: formData.get("kind") });
  if (!form.success) return { message: "Unknown kind of sync.", tone: "error" };

  const result = await getContainer().catalog.requestSync(admin, form.data.kind);
  revalidatePath("/admin/catalog");
  if (!result.ok) return { message: syncMessageFor(result.error), tone: "error" };
  return {
    message: "Queued. The worker picks it up within 30 seconds (it must be running).",
    tone: "success",
  };
}

// It needs no form fields, so it ignores the arguments useActionState passes.
export async function enableStandardSetsAction(): Promise<CatalogActionState> {
  const admin = await requireAdminActor();
  const result = await getContainer().catalog.enableStandardSets(admin);
  revalidatePath("/admin/catalog");
  if (!result.ok) return { message: "Only admins can do that.", tone: "error" };
  return result.value.length === 0
    ? { message: "Every current Standard set is already enabled.", tone: "success" }
    : { message: `Enabled ${result.value.join(", ")}. A sync was queued.`, tone: "success" };
}

const SetForm = z.object({ code: z.string().min(1), enabled: z.enum(["true", "false"]) });

/** Enable/disable buttons in the sets list. No message: the list itself shows the new state. */
export async function setSetEnabledAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActor();
  const form = SetForm.safeParse({ code: formData.get("code"), enabled: formData.get("enabled") });
  if (!form.success) return;
  const result = await getContainer().catalog.setSetEnabled(admin, {
    code: SetCode.of(form.data.code),
    enabled: form.data.enabled === "true",
  });
  if (!result.ok) console.warn("set enable:", setMessageFor(result.error));
  revalidatePath("/admin/catalog");
}

function syncMessageFor(error: RequestSyncError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can start a sync.";
    case "SyncAlreadyQueued":
      return "A sync is already queued or running.";
    default:
      return assertNever(error);
  }
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
