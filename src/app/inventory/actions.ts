"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ItemId } from "@/modules/inventory";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

const OpenForm = z.object({
  itemIds: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((text) => text.split(",").map((id) => ItemId.of(Number(id)))),
  mode: z.enum(["one", "all"]),
});

/** Opens one item, or opens items and everything inside them, then shows what came out. */
export async function openAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const form = OpenForm.safeParse({ itemIds: formData.get("itemIds"), mode: formData.get("mode") });
  if (!form.success) redirect("/inventory?error=ItemNotFound");

  const { inventory } = getContainer();
  const [first] = form.data.itemIds;
  const result =
    form.data.mode === "one"
      ? await inventory.openItem(actor, first)
      : await inventory.openAll(actor, form.data.itemIds);
  if (!result.ok) redirect(`/inventory?error=${result.error.kind}`);

  const openings = Array.isArray(result.value) ? result.value : [result.value];
  revalidatePath("/inventory");
  revalidatePath("/collection");
  // animate=1: play the packs in the opener first (design doc 08, section 5).
  const ids = openings.map((opening) => opening.item.id).join(",");
  redirect(`/inventory/opened?items=${ids}&animate=1`);
}
