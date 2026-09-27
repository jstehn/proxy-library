"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SealedProductId } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { Cents } from "@/shared/kernel";

/** "" clears the price; anything else must read as dollars. Undefined means "couldn't read it". */
function parsePrice(raw: FormDataEntryValue | null): Cents | null | undefined {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  return Cents.fromUsd(text) ?? undefined;
}

function done(back: string, error?: string): never {
  revalidatePath("/admin/store");
  revalidatePath("/store", "layout");
  redirect(
    error === undefined
      ? back
      : `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`,
  );
}

export async function setKindPriceAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const back = String(formData.get("back") ?? "/admin/store");
  const price = parsePrice(formData.get("price"));
  if (price === undefined) done(back, "Enter a price like 5.49, or leave it empty.");
  const result = await getContainer().store.setKindPrice(actor, {
    kind: String(formData.get("kind")),
    price,
  });
  done(
    back,
    result.ok
      ? undefined
      : `Price ${result.error.kind === "PriceInvalid" ? result.error.reason : "not allowed"}.`,
  );
}

export async function setProductPriceAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const back = String(formData.get("back") ?? "/admin/store");
  const price = parsePrice(formData.get("price"));
  if (price === undefined) done(back, "Enter a price like 5.49, or leave it empty.");
  const result = await getContainer().store.setProductPrice(actor, {
    productId: SealedProductId.of(String(formData.get("productId"))),
    price,
  });
  done(
    back,
    result.ok
      ? undefined
      : `Price ${result.error.kind === "PriceInvalid" ? result.error.reason : "not allowed"}.`,
  );
}

/** "50" or "50%" → 5000 basis points. Undefined when it isn't a number. */
function parsePercent(raw: FormDataEntryValue | null): number | undefined {
  const text = typeof raw === "string" ? raw.trim().replace(/%$/, "") : "";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return undefined;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export async function setBuylistRateAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const rate = parsePercent(formData.get("rate"));
  if (rate === undefined) done("/admin/store", "Enter a percentage like 50.");
  const result = await getContainer().store.setBuylistRate(actor, rate);
  done("/admin/store", result.ok ? undefined : "The rate must be between 0% and 100%.");
}
