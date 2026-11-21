"use server";
import { z } from "zod";
import { SetCode, describePhotoError } from "@/modules/catalog";
import { formRedirect } from "@/server/form-action-instance";
import { revalidateHeader } from "../../paths";
import { adminPath, photosSetPath } from "../paths";

// Admin → Photos (design doc 13): pick a product's WPN photo, or set a set's page address. A form
// that can't be read goes back to the photos list.

const FORM_UNREADABLE = { admin: true, unreadable: adminPath("photos") } as const;

/** Where a button goes back to: the store and inventory show these photos, so refresh them all. */
function backTo(code: string, message: string, tone: "message" | "error" = "message"): string {
  revalidateHeader();
  return photosSetPath(code, tone, message);
}

const ChoiceForm = z.object({
  code: z.string().regex(/^[A-Z0-9]{2,8}$/),
  productId: z.string().min(1),
  /** "auto" undoes a choice; "none" means generated art; otherwise "<WPN name>|<photo index>". */
  choice: z.string().min(1),
});

export const choosePhotoAction = formRedirect(
  ChoiceForm,
  async ({ actor: admin, capabilities }, { code, productId, choice }) => {
    const { catalog } = capabilities;
    if (choice === "auto") {
      await catalog.clearPhotoChoice(admin, productId);
      return backTo(
        code,
        "Undone: the product is matched again when its page is read (sync queued).",
      );
    }
    const separator = choice.lastIndexOf("|");
    const wpnName = choice === "none" ? null : choice.slice(0, separator);
    const photoIndex = choice === "none" ? null : Number(choice.slice(separator + 1));
    const result = await catalog.choosePhoto(admin, {
      productId,
      wpnName,
      photoIndex: photoIndex === null || photoIndex < 0 ? null : photoIndex,
    });
    if (!result.ok) return backTo(code, describePhotoError(result.error), "error");
    return backTo(code, "Saved.");
  },
  FORM_UNREADABLE,
);

export const setPageSlugAction = formRedirect(
  z.object({ code: z.string().regex(/^[A-Z0-9]{2,8}$/), slug: z.string().max(120) }),
  async ({ actor: admin, capabilities }, { code, slug }) => {
    const result = await capabilities.catalog.setPageSlug(admin, {
      setCode: SetCode.of(code),
      slug: slug.trim() === "" ? null : slug,
    });
    if (!result.ok) return backTo(code, describePhotoError(result.error), "error");
    return backTo(code, "Saved. The page is read at the next sync (queued).");
  },
  FORM_UNREADABLE,
);
