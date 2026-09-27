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

/** Every other set this set's boosters, decks and products draw cards from. */
export function supportingSetCodes(setImport: SetImport): SetCode[] {
  const codes = new Set<SetCode>();
  for (const booster of setImport.boosters) {
    booster.sourceSetCodes.forEach((code) => codes.add(code));
  }
  for (const deck of setImport.decks) deck.sourceSetCodes.forEach((code) => codes.add(code));
  setImport.productCardSetCodes.forEach((code) => codes.add(code));
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
 * Rule 5: nothing we keep may refer to something we don't have. Boosters, decks and products
 * whose references can't be satisfied (by this set or the rest of the catalog) are left out,
 * and each is reported. Leaving one out can break another (a box of a dropped booster), so this
 * repeats until nothing more changes.
 */
export function withoutBrokenReferences(
  setImport: SetImport,
  known: KnownCatalog,
): { setImport: SetImport; leftOut: string[] } {
  const printingIds = new Set(setImport.printings.map((printing) => printing.id));
  const hasPrinting = (id: PrintingId) => printingIds.has(id) || known.hasPrinting(id);
  const leftOut: string[] = [];

  let boosters = [...setImport.boosters];
  let decks = [...setImport.decks];
  let products = [...setImport.products];

  boosters = boosters.filter((booster) => {
    for (const [sheetName, sheet] of Object.entries(booster.sheets)) {
      const missing = sheet.cards.filter((card) => !hasPrinting(card.printingId)).length;
      if (missing > 0) {
        leftOut.push(
          `booster ${booster.boosterType}: sheet ${sheetName} has ${missing} unknown card(s)`,
        );
        return false;
      }
    }
    return true;
  });

  decks = decks.filter((deck) => {
    const missing = deck.cards.filter((card) => !hasPrinting(card.printingId)).length;
    if (missing > 0) leftOut.push(`deck "${deck.name}": ${missing} unknown card(s)`);
    return missing === 0;
  });

  // Products can contain other products, so keep filtering until nothing more is dropped.
  for (let changed = true; changed;) {
    changed = false;
    const productIds = new Set(products.map((product) => product.id));
    const boosterKeys = new Set(boosters.map((b) => `${b.setCode}/${b.boosterType}`));
    const deckKeys = new Set(decks.map((d) => `${d.setCode}/${d.name}`));

    products = products.filter((product) => {
      const problem = firstProblem(product.contents, {
        hasPrinting,
        hasProduct: (id) => productIds.has(id) || known.hasProduct(id),
        hasBooster: (code, type) =>
          boosterKeys.has(`${code}/${type}`) || known.hasBooster(code, type),
        hasDeck: (code, name) => deckKeys.has(`${code}/${name}`) || known.hasDeck(code, name),
      });
      if (problem === null) return true;
      leftOut.push(`product "${product.name}": ${problem}`);
      changed = true;
      return false;
    });
  }

  return { setImport: { ...setImport, boosters, decks, products }, leftOut };
}

function firstProblem(contents: readonly SealedContent[], known: KnownCatalog): string | null {
  const refs = contentReferences(contents);
  const card = refs.printingIds.find((id) => !known.hasPrinting(id));
  if (card !== undefined) return `unknown card ${card}`;
  const product = refs.productIds.find((id) => !known.hasProduct(id));
  if (product !== undefined) return `unknown product ${product}`;
  const pack = refs.packs.find((p) => !known.hasBooster(p.setCode, p.boosterType));
  if (pack !== undefined) return `unknown booster ${pack.setCode}/${pack.boosterType}`;
  const deck = refs.decks.find((d) => !known.hasDeck(d.setCode, d.deckName));
  if (deck !== undefined) return `unknown deck ${deck.setCode}/${deck.deckName}`;
  return null;
}

// --- Standard sets, prices and the nightly schedule -----------------------------------------

/** Per set: how many of its cards count, and how many of those are Standard-legal. */
export type StandardTally = Map<SetCode, { legal: number; total: number }>;

/**
 * Adds one card to the tally. Only English paper cards from expansion/core sets count, and basic
 * lands are ignored because they're Standard-legal in every set, old or new.
 */
export function tallyStandard(tally: StandardTally, card: ScryfallCard): void {
  const isMainSet = card.setType === "expansion" || card.setType === "core";
  if (!isMainSet || card.isDigital || card.language !== "en" || card.isBasicLand) return;
  const counts = tally.get(card.setCode) ?? { legal: 0, total: 0 };
  counts.total++;
  if (card.isStandardLegal) counts.legal++;
  tally.set(card.setCode, counts);
}

/**
 * Sets where at least half of the counted cards are Standard-legal. Real data splits cleanly:
 * current Standard sets are 99–100% legal, older sets at most about 25% (their reprints).
 */
export function standardSetsFromTally(tally: StandardTally, threshold = 0.5): SetCode[] {
  return [...tally.entries()]
    .filter(([, counts]) => counts.total > 0 && counts.legal / counts.total >= threshold)
    .map(([code]) => code)
    .sort();
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
