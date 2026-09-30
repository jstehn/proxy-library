"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SetCode, type ChoosePhotoError, type SetPageSlugError } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { assertNever } from "@/shared/kernel";

// Admin → Photos (design doc 13): pick a product's WPN photo, or set a set's page address.

const ChoiceForm = z.object({
  code: z.string().regex(/^[A-Z0-9]{2,8}$/),
  productId: z.string().min(1),
  /** "auto" undoes a choice; "none" means generated art; otherwise "<WPN name>|<photo index>". */
  choice: z.string().min(1),
});

export async function choosePhotoAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActor();
  const form = ChoiceForm.safeParse({
    code: formData.get("code"),
    productId: formData.get("productId"),
    choice: formData.get("choice"),
  });
  if (!form.success) redirect("/admin/photos");
  const { code, productId, choice } = form.data;
  const { catalog } = getContainer();

  if (choice === "auto") {
    await catalog.clearPhotoChoice(admin, productId);
    backTo(code, "Undone: the product is matched again when its page is read (sync queued).");
  }
  const separator = choice.lastIndexOf("|");
  const wpnName = choice === "none" ? null : choice.slice(0, separator);
  const photoIndex = choice === "none" ? null : Number(choice.slice(separator + 1));
  const result = await catalog.choosePhoto(admin, {
    productId,
    wpnName,
    photoIndex: photoIndex === null || photoIndex < 0 ? null : photoIndex,
  });
  if (!result.ok) backTo(code, messageFor(result.error), "error");
  backTo(code, "Saved.");
}

const SlugForm = z.object({
  code: z.string().regex(/^[A-Z0-9]{2,8}$/),
  slug: z.string().max(120),
});

export async function setPageSlugAction(formData: FormData): Promise<void> {
  const admin = await requireAdminActor();
  const form = SlugForm.safeParse({ code: formData.get("code"), slug: formData.get("slug") });
  if (!form.success) redirect("/admin/photos");
  const result = await getContainer().catalog.setPageSlug(admin, {
    setCode: SetCode.of(form.data.code),
    slug: form.data.slug.trim() === "" ? null : form.data.slug,
  });
  if (!result.ok) backTo(form.data.code, messageFor(result.error), "error");
  backTo(form.data.code, "Saved. The page is read at the next sync (queued).");
}

function backTo(code: string, message: string, tone: "success" | "error" = "success"): never {
  revalidatePath("/", "layout"); // the store and inventory show these photos
  const params = new URLSearchParams({ [tone === "error" ? "error" : "message"]: message });
  redirect(`/admin/photos/${code}?${params.toString()}`);
}

function messageFor(error: ChoosePhotoError | SetPageSlugError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can change photos.";
    case "ProductNotFound":
      return "That product isn't in the catalog.";
    case "PhotoNotOnPage":
      return "That photo isn't on this set's WPN page.";
    case "SetNotFound":
      return "That set isn't in the catalog.";
    case "SlugInvalid":
      return "A page address is lowercase words joined by hyphens, like secrets-of-strixhaven.";
    default:
      return assertNever(error);
  }
}
