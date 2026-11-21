"use server";
import { z } from "zod";
import { SealedProductId } from "@/modules/catalog";
import { PRICING_MODES } from "@/modules/store";
import { formRedirect } from "@/server/form-action-instance";
import { Cents } from "@/shared/kernel";
import { adminPath, revalidateAdminStore } from "../paths";

const STORE_PATH = adminPath("store");
const PRICE_UNREADABLE = "Enter a price like 5.49, or leave it empty.";

/** "" clears the price; anything else must read as dollars. Undefined means "couldn't read it". */
function parsePrice(text: string): Cents | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return Cents.fromUsd(trimmed) ?? undefined;
}

/** Where a button goes back to, after refreshing the store pages, with the error if there was one. */
function done(back: string, error?: string): string {
  revalidateAdminStore();
  if (error === undefined) return back;
  return `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`;
}

const PriceFormFields = {
  back: z.string().default(STORE_PATH),
  price: z.string().default(""),
};

function priceProblem(error: { kind: string; reason?: string }): string {
  return `Price ${error.kind === "PriceInvalid" ? error.reason : "not allowed"}.`;
}

export const setKindPriceAction = formRedirect(
  z.object({ ...PriceFormFields, kind: z.string().default("") }),
  async ({ actor, capabilities }, { back, price: text, kind }) => {
    const price = parsePrice(text);
    if (price === undefined) return done(back, PRICE_UNREADABLE);
    const result = await capabilities.store.setKindPrice(actor, { kind, price });
    return done(back, result.ok ? undefined : priceProblem(result.error));
  },
  { admin: true },
);

export const setProductPriceAction = formRedirect(
  z.object({ ...PriceFormFields, productId: z.string().default("") }),
  async ({ actor, capabilities }, { back, price: text, productId }) => {
    const price = parsePrice(text);
    if (price === undefined) return done(back, PRICE_UNREADABLE);
    const result = await capabilities.store.setProductPrice(actor, {
      productId: SealedProductId.of(productId),
      price,
    });
    return done(back, result.ok ? undefined : priceProblem(result.error));
  },
  { admin: true },
);

/** "50" or "50%" → 5000 basis points. Undefined when it isn't a number. */
function parsePercent(text: string): number | undefined {
  const trimmed = text.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Chooses MSRP or value-based pricing for sealed product (design doc 33). */
export const setPricingModeAction = formRedirect(
  z.object({ mode: z.string().default("") }),
  async ({ actor, capabilities }, { mode: text }) => {
    const mode = PRICING_MODES.find((one) => one === text);
    if (mode === undefined) return done(STORE_PATH, "Choose MSRP or value-based pricing.");
    const result = await capabilities.store.setPricingMode(actor, mode);
    return done(STORE_PATH, result.ok ? undefined : "Only admins can change pricing.");
  },
  { admin: true },
);

export const setBuylistRateAction = formRedirect(
  z.object({ rate: z.string().default("") }),
  async ({ actor, capabilities }, { rate: text }) => {
    const rate = parsePercent(text);
    if (rate === undefined) return done(STORE_PATH, "Enter a percentage like 50.");
    const result = await capabilities.store.setBuylistRate(actor, rate);
    return done(STORE_PATH, result.ok ? undefined : "The rate must be between 0% and 100%.");
  },
  { admin: true },
);
