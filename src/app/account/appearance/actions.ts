"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseForm } from "@/server/form-action";
import { readPage } from "@/server/page-instance";
import { writeThemeCookie } from "@/server/theme";

export type AppearanceFormState = Readonly<{
  error: string | null;
  saved: boolean;
}>;

const AppearanceFormSchema = z.object({
  themeId: z.string().default("system"),
  showBackdrop: z.string().optional(),
});

export async function saveAppearanceAction(
  _previous: AppearanceFormState,
  formData: FormData,
): Promise<AppearanceFormState> {
  const { actor, capabilities } = await readPage();
  const parsed = parseForm(AppearanceFormSchema, formData);
  if (!parsed.success) {
    return { error: "Please check your selection and try again.", saved: false };
  }

  const showBackdrop = parsed.data.showBackdrop === "on";
  const saved = await capabilities.social.updateThemePreference(actor.userId, {
    themeId: parsed.data.themeId,
    showBackdrop,
  });

  if (!saved.ok) {
    return { error: `Unknown theme "${saved.error.themeId}".`, saved: false };
  }

  await writeThemeCookie(saved.value);
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}
