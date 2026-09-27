// Anti-corruption layer (ADR 0007): turns parsed MTGJSON data into the catalog's own types,
// applying the paper-only rules on the way in (design doc 04, rule 9). Pure functions only.
import {
  isDigitalBoosterType,
  isDigitalCodeExtra,
  isDigitalOnlyDeck,
  isDigitalOnlyProduct,
  isPaperPrinting,
  variantLabel,
} from "../domain/rules";
import {
  FINISHES,
  PrintingId,
  SealedProductId,
  SetCode,
  type BoosterConfig,
  type CardSetInfo,
  type Color,
  type DeckCard,
  type DeckList,
  type Finish,
  type Printing,
  type Rarity,
  type SealedContent,
  type SealedProduct,
  type SetImport,
} from "../domain/types";
import type {
  MtgjsonBooster,
  MtgjsonCard,
  MtgjsonContents,
  MtgjsonDeck,
  MtgjsonSealedProduct,
  MtgjsonSetFile,
  MtgjsonSetSummary,
} from "./mtgjson-schema";

const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

export function mapSetSummary(raw: MtgjsonSetSummary): CardSetInfo {
  return {
    code: SetCode.of(raw.code),
    name: raw.name,
    releaseDate: raw.releaseDate,
    type: raw.type,
    keyruneCode: raw.keyruneCode,
    parentCode: raw.parentCode === undefined ? null : SetCode.of(raw.parentCode),
  };
}

/** Maps one card, or returns null if it isn't a paper printing we can use. */
export function mapPrinting(raw: MtgjsonCard): Printing | null {
  const { scryfallId, scryfallOracleId } = raw.identifiers;
  if (!isPaperPrinting(raw.availability)) return null;
  if (scryfallId === undefined || scryfallOracleId === undefined) return null;

  const treatments = {
    borderColor: raw.borderColor,
    frameVersion: raw.frameVersion,
    frameEffects: raw.frameEffects,
    promoTypes: raw.promoTypes,
    isFullArt: raw.isFullArt,
  };
  return {
    id: PrintingId.of(raw.uuid),
    setCode: SetCode.of(raw.setCode),
    collectorNumber: raw.number,
    name: raw.name,
    oracleId: scryfallOracleId,
    scryfallId,
    rarity: RARITIES.includes(raw.rarity as Rarity) ? (raw.rarity as Rarity) : "special",
    colors: raw.colors.filter((color): color is Color => COLORS.includes(color as Color)),
    colorIdentity: raw.colorIdentity.filter((color): color is Color =>
      COLORS.includes(color as Color),
    ),
    manaCost: raw.manaCost ?? null,
    manaValue: raw.manaValue,
    typeLine: raw.type,
    layout: raw.layout,
    // Always in the same order (nonfoil, foil, etched), whatever order MTGJSON lists them in.
    finishes: FINISHES.filter((finish) => raw.finishes.includes(finish)),
    treatments,
    variantLabel: variantLabel(treatments),
  };
}

/** Maps any face's id to the card's front-face id (unchanged for single-faced cards). */
export type FaceResolver = (uuid: string) => PrintingId;
const sameId: FaceResolver = (uuid) => PrintingId.of(uuid);

export function mapBooster(
  setCode: SetCode,
  boosterType: string,
  raw: MtgjsonBooster,
  resolve: FaceResolver = sameId,
): BoosterConfig {
  return {
    setCode,
    boosterType,
    variants: raw.boosters.map((variant) => ({ weight: variant.weight, slots: variant.contents })),
    sheets: Object.fromEntries(
      Object.entries(raw.sheets).map(([name, sheet]) => [
        name,
        {
          cards: Object.entries(sheet.cards).map(([uuid, weight]) => ({
            printingId: resolve(uuid),
            weight,
          })),
          isFoil: sheet.foil,
          allowDuplicates: sheet.allowDuplicates,
          balanceColors: sheet.balanceColors,
          isFixed: sheet.fixed,
        },
      ]),
    ),
    sourceSetCodes: raw.sourceSetCodes.map((code) => SetCode.of(code)),
  };
}

function cardFinish(card: { foil?: boolean; finishes?: string[] }): Finish {
  if (card.finishes?.length === 1 && card.finishes[0] === "etched") return "etched";
  return card.foil ? "foil" : "nonfoil";
}

export function mapContents(raw: MtgjsonContents, resolve: FaceResolver = sameId): SealedContent[] {
  const contents: SealedContent[] = [];
  for (const card of raw.card ?? []) {
    contents.push({ kind: "card", printingId: resolve(card.uuid), finish: cardFinish(card) });
  }
  for (const pack of raw.pack ?? []) {
    contents.push({ kind: "pack", setCode: SetCode.of(pack.set), boosterType: pack.code });
  }
  for (const sealed of raw.sealed ?? []) {
    contents.push({
      kind: "sealed",
      productId: SealedProductId.of(sealed.uuid),
      count: sealed.count,
    });
  }
  for (const deck of raw.deck ?? []) {
    contents.push({ kind: "deck", setCode: SetCode.of(deck.set), deckName: deck.name });
  }
  for (const other of raw.other ?? []) {
    if (!isDigitalCodeExtra(other.name)) contents.push({ kind: "other", name: other.name });
  }
  for (const variable of raw.variable ?? []) {
    contents.push({
      kind: "variable",
      options: variable.configs.map((config) => mapContents(config, resolve)),
    });
  }
  return contents;
}

export function mapSealedProduct(
  setCode: SetCode,
  raw: MtgjsonSealedProduct,
  resolve: FaceResolver = sameId,
): SealedProduct {
  return {
    id: SealedProductId.of(raw.uuid),
    setCode,
    name: raw.name,
    category: raw.category,
    subtype: raw.subtype,
    releaseDate: raw.releaseDate ?? null,
    contents: mapContents(raw.contents, resolve),
  };
}

export function mapDeck(
  setCode: SetCode,
  raw: MtgjsonDeck,
  resolve: FaceResolver = sameId,
): DeckList {
  const toCard =
    (board: DeckCard["board"]) =>
    (card: MtgjsonDeck["mainBoard"][number]): DeckCard => ({
      printingId: resolve(card.uuid),
      count: card.count,
      finish: card.isEtched ? "etched" : card.isFoil ? "foil" : "nonfoil",
      board,
    });
  return {
    setCode,
    name: raw.name,
    type: raw.type,
    cards: [
      ...raw.commander.map(toCard("commander")),
      ...raw.mainBoard.map(toCard("main")),
      ...raw.sideBoard.map(toCard("side")),
    ],
    sourceSetCodes: raw.sourceSetCodes.map((code) => SetCode.of(code)),
  };
}

/** A whole set file → what the catalog imports, with digital-only things left out and counted. */
export function mapSetFile(file: MtgjsonSetFile): SetImport {
  const set = mapSetSummary(file.data);

  // A double-faced card is listed once per face (side "a", "b", …) with the same Scryfall id.
  // We keep one printing per physical card (the front face), and point references to any other
  // face at the front.
  const isFrontFace = (card: MtgjsonCard) => card.side === undefined || card.side === "a";
  const frontOf = new Map<string, string>();
  for (const card of file.data.cards.filter(isFrontFace)) {
    for (const otherFace of card.otherFaceIds) frontOf.set(otherFace, card.uuid);
  }
  const resolve: FaceResolver = (uuid) => PrintingId.of(frontOf.get(uuid) ?? uuid);

  const printings: Printing[] = [];
  let skippedPrintings = 0;
  for (const card of file.data.cards.filter(isFrontFace)) {
    const printing = mapPrinting(card);
    if (printing === null) skippedPrintings++;
    else printings.push(printing);
  }

  const boosterEntries = Object.entries(file.data.booster);
  const products = file.data.sealedProduct;

  return {
    set,
    version: file.meta.version,
    printings,
    boosters: boosterEntries
      .filter(([type]) => !isDigitalBoosterType(type))
      .map(([type, raw]) => mapBooster(set.code, type, raw, resolve)),
    products: products
      .filter((product) => !isDigitalOnlyProduct(product))
      .map((product) => mapSealedProduct(set.code, product, resolve)),
    decks: file.data.decks
      .filter((deck) => !isDigitalOnlyDeck(deck))
      .map((deck) => mapDeck(set.code, deck, resolve)),
    productCardSetCodes: productCardSets(products.filter((p) => !isDigitalOnlyProduct(p))),
    skipped: {
      printings: skippedPrintings,
      boosterTypes: boosterEntries.map(([type]) => type).filter(isDigitalBoosterType),
      products: products.filter(isDigitalOnlyProduct).map((product) => product.name),
      decks: file.data.decks.filter(isDigitalOnlyDeck).map((deck) => deck.name),
    },
  };
}

/** The sets that products' individual cards come from (e.g. a prerelease promo set). */
function productCardSets(products: readonly MtgjsonSealedProduct[]): SetCode[] {
  const codes = new Set<SetCode>();
  function visit(contents: MtgjsonContents) {
    for (const card of contents.card ?? []) codes.add(SetCode.of(card.set));
    for (const variable of contents.variable ?? []) variable.configs.forEach(visit);
  }
  products.forEach((product) => visit(product.contents));
  return [...codes];
}
