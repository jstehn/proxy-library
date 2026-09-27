import type {
  PrintingId,
  ScryfallCard,
  SealedContent,
  SealedProductId,
  SetCode,
  SetImport,
  Treatments,
  PriceSnapshot,
  Printing,
} from "./types";

// Pure catalog rules (design doc 04, section 3). No I/O: everything comes in as arguments.

// --- Variant labels ------------------------------------------------------------------------

// Treatment codes worth showing to players, in display order. Unknown codes are ignored, so a
// new MTGJSON code never shows up as gibberish.
const FRAME_EFFECT_LABELS: ReadonlyArray<[string, string]> = [
  ["showcase", "Showcase"],
  ["extendedart", "Extended Art"],
  ["etched", "Foil-Etched"],
];
const PROMO_TYPE_LABELS: ReadonlyArray<[string, string]> = [
  ["serialized", "Serialized"],
  ["textured", "Textured Foil"],
  ["galaxyfoil", "Galaxy Foil"],
  ["surgefoil", "Surge Foil"],
  ["raisedfoil", "Raised Foil"],
  ["halofoil", "Halo Foil"],
  ["confettifoil", "Confetti Foil"],
  ["fracturefoil", "Fracture Foil"],
  ["rainbowfoil", "Rainbow Foil"],
  ["doublerainbow", "Double Rainbow Foil"],
  ["stepandcompleat", "Step-and-Compleat Foil"],
  ["oilslick", "Oil Slick"],
  ["neonink", "Neon Ink"],
  ["prerelease", "Prerelease Promo"],
  ["promopack", "Promo Pack"],
  ["bundle", "Bundle Promo"],
  ["starterdeck", "Starter Deck"],
];

/** "Borderless · Showcase · Raised Foil", or "" for the regular version of a card. */
export function variantLabel(treatments: Treatments): string {
  const parts: string[] = [];
  if (treatments.borderColor === "borderless") parts.push("Borderless");
  for (const [code, label] of FRAME_EFFECT_LABELS) {
    if (treatments.frameEffects.includes(code)) parts.push(label);
  }
  if (treatments.isFullArt) parts.push("Full Art");
  for (const [code, label] of PROMO_TYPE_LABELS) {
    if (treatments.promoTypes.includes(code)) parts.push(label);
  }
  return parts.join(" · ");
}

// --- Paper only (design doc 04, rule 9): exclude only what exists ONLY digitally -----------

/** A printing is kept when it exists in paper, even if it's also on MTGO or Arena. */
export function isPaperPrinting(availability: readonly string[]): boolean {
  return availability.includes("paper");
}

/** Booster configurations that exist only for digital play, e.g. "play-arena". */
export function isDigitalBoosterType(boosterType: string): boolean {
  return /-(arena|mtgo)$/.test(boosterType) || boosterType === "arena" || boosterType === "mtgo";
}

/** Products that are only a digital redemption, with no paper product (e.g. MTGO redemption). */
export function isDigitalOnlyProduct(product: { subtype: string | null }): boolean {
  return product.subtype === "mtgo_redemption";
}

/** Deck lists that exist only for digital redemption. */
export function isDigitalOnlyDeck(deck: { type: string }): boolean {
  return deck.type === "MTGO Redemption";
}

/** "2 MTG Arena codes" and similar inserts: left out of a product's listed extras. */
export function isDigitalCodeExtra(name: string): boolean {
  return /\b(arena|mtgo)\b/i.test(name);
}

// --- Supporting sets and references ---------------------------------------------------------

/** Every other set this set's boosters, products and decks draw cards from. */
export function supportingSetCodes(setImport: SetImport): SetCode[] {
  const codes = new Set<SetCode>();
  for (const booster of setImport.boosters)
    booster.sourceSetCodes.forEach((code) => codes.add(code));
  for (const deck of setImport.decks) deck.sourceSetCodes.forEach((code) => codes.add(code));
  codes.delete(setImport.set.code);
  return [...codes].sort();
}

/** Every printing and product a product's contents refer to, however deeply nested. */
export function contentReferences(contents: readonly SealedContent[]): {
  printingIds: PrintingId[];
  productIds: SealedProductId[];
  packs: { setCode: SetCode; boosterType: string }[];
  decks: { setCode: SetCode; deckName: string }[];
} {
  const found = {
    printingIds: [] as PrintingId[],
    productIds: [] as SealedProductId[],
    packs: [] as { setCode: SetCode; boosterType: string }[],
    decks: [] as { setCode: SetCode; deckName: string }[],
  };
  function visit(items: readonly SealedContent[]) {
    for (const item of items) {
      switch (item.kind) {
        case "card":
          found.printingIds.push(item.printingId);
          break;
        case "sealed":
          found.productIds.push(item.productId);
          break;
        case "pack":
          found.packs.push({ setCode: item.setCode, boosterType: item.boosterType });
          break;
        case "deck":
          found.decks.push({ setCode: item.setCode, deckName: item.deckName });
          break;
        case "variable":
          item.options.forEach(visit);
          break;
        case "other":
          break;
      }
    }
  }
  visit(contents);
  return found;
}

/** What the rest of the catalog already has, for checking references (rule 5). */
export type KnownCatalog = Readonly<{
  hasPrinting(id: PrintingId): boolean;
  hasProduct(id: SealedProductId): boolean;
  hasBooster(setCode: SetCode, boosterType: string): boolean;
  hasDeck(setCode: SetCode, deckName: string): boolean;
}>;

/**
 * Rule 5: every card, product, booster and deck a set refers to must exist, either in this set
 * or already in the catalog. Returns human-readable problems (empty = all good).
 */
export function missingReferences(setImport: SetImport, known: KnownCatalog): string[] {
  const own = {
    printings: new Set(setImport.printings.map((printing) => printing.id)),
    products: new Set(setImport.products.map((product) => product.id)),
    boosters: new Set(setImport.boosters.map((b) => `${b.setCode}/${b.boosterType}`)),
    decks: new Set(setImport.decks.map((d) => `${d.setCode}/${d.name}`)),
  };
  const hasPrinting = (id: PrintingId) => own.printings.has(id) || known.hasPrinting(id);
  const problems: string[] = [];

  for (const booster of setImport.boosters) {
    for (const [sheetName, sheet] of Object.entries(booster.sheets)) {
      const missing = sheet.cards.filter((card) => !hasPrinting(card.printingId));
      if (missing.length > 0) {
        problems.push(
          `booster ${booster.boosterType}, sheet ${sheetName}: ${missing.length} unknown card(s)`,
        );
      }
    }
  }
  for (const deck of setImport.decks) {
    const missing = deck.cards.filter((card) => !hasPrinting(card.printingId));
    if (missing.length > 0) problems.push(`deck "${deck.name}": ${missing.length} unknown card(s)`);
  }
  for (const product of setImport.products) {
    const refs = contentReferences(product.contents);
    const where = `product "${product.name}"`;
    for (const id of refs.printingIds)
      if (!hasPrinting(id)) problems.push(`${where}: unknown card ${id}`);
    for (const id of refs.productIds) {
      if (!own.products.has(id) && !known.hasProduct(id))
        problems.push(`${where}: unknown product ${id}`);
    }
    for (const pack of refs.packs) {
      const key = `${pack.setCode}/${pack.boosterType}`;
      if (!own.boosters.has(key) && !known.hasBooster(pack.setCode, pack.boosterType)) {
        problems.push(`${where}: unknown booster ${key}`);
      }
    }
    for (const deck of refs.decks) {
      const key = `${deck.setCode}/${deck.deckName}`;
      if (!own.decks.has(key) && !known.hasDeck(deck.setCode, deck.deckName)) {
        problems.push(`${where}: unknown deck ${key}`);
      }
    }
  }
  return problems;
}

// --- Standard sets, prices and the nightly schedule -----------------------------------------

/** Does this card make its set a Standard set? Paper, expansion/core, Standard-legal. */
export function countsTowardStandard(
  card: Pick<ScryfallCard, "setType" | "isDigital" | "isStandardLegal">,
): boolean {
  const isMainSet = card.setType === "expansion" || card.setType === "core";
  return isMainSet && !card.isDigital && card.isStandardLegal;
}

/** Paper expansion/core sets with at least one Standard-legal card (design doc 04, section 3). */
export function standardSetCodes(cards: Iterable<ScryfallCard>): Set<SetCode> {
  const codes = new Set<SetCode>();
  for (const card of cards) {
    if (countsTowardStandard(card)) codes.add(card.setCode);
  }
  return codes;
}

/** Today's snapshot for each finish the printing has AND Scryfall has a price for. */
export function priceSnapshots(
  printing: Pick<Printing, "id" | "finishes">,
  card: Pick<ScryfallCard, "prices">,
  day: string,
): PriceSnapshot[] {
  const snapshots: PriceSnapshot[] = [];
  for (const finish of printing.finishes) {
    const price = card.prices[finish];
    if (price !== null) snapshots.push({ printingId: printing.id, finish, day, price });
  }
  return snapshots;
}

/** "2026-09-27": the UTC calendar day of an instant, used as the snapshot's day. */
export function snapshotDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Is it time for the nightly sync? True once `now` has passed today's sync time (in the
 * server's local time zone) and no run has started since then.
 */
export function isNightlySyncDue(input: {
  lastRunStartedAt: Date | null;
  now: Date;
  syncTime: { hour: number; minute: number };
}): boolean {
  const { lastRunStartedAt, now, syncTime } = input;
  const todaysSyncTime = new Date(now.getTime());
  todaysSyncTime.setHours(syncTime.hour, syncTime.minute, 0, 0);
  if (now.getTime() < todaysSyncTime.getTime()) return false;
  return lastRunStartedAt === null || lastRunStartedAt.getTime() < todaysSyncTime.getTime();
}
