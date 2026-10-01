// Wizards Play Network (WPN) product pages: official product photos, key art, MSRPs and product
// details (design doc 13). Pure: the gateway turns a page into a WpnSetPage, and this file
// decides which of our products each WPN product belongs to.

/** One image on Wizards' image host, identified by its asset (stable across sizes). */
export type WpnImage = Readonly<{
  /** `<asset id>-<version>`, safe in a file name and a URL. */
  id: string;
  /** The image's address without size parameters, e.g. "//images.ctfassets.net/…/x.png". */
  url: string;
}>;

/** One line of a product's contents list, with how deeply it's indented. */
export type ContentsLine = Readonly<{ depth: number; text: string }>;

/** One product on a WPN page. */
export type WpnProduct = Readonly<{
  name: string;
  releaseDate: string | null; // "2026-04-24"
  msrpCents: number | null;
  description: string | null; // plain text
  contents: readonly ContentsLine[]; // plain text
  images: readonly WpnImage[];
}>;

/** What a set's WPN page offers. */
export type WpnSetPage = Readonly<{
  slug: string;
  keyArt: WpnImage | null;
  products: readonly WpnProduct[];
}>;

/**
 * The page addresses to try for a set, best first: its name as a slug, then with
 * "magic-the-gathering-" in front (Foundations, Avatar: The Last Airbender). Checked on all our
 * main sets on 2026-09-30.
 */
export function slugCandidates(setName: string): string[] {
  const slug = setName
    .replace(/[™®]/g, "") // before normalizing, which would turn "™" into "TM"
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents: "Lórien" → "Lorien"
    .toLowerCase()
    .replace(/['’™®]/g, "") // "Marvel's" → "marvels"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? [] : [slug, `magic-the-gathering-${slug}`];
}

/** One of our sealed products, as matching needs it. */
export type ProductForMatching = Readonly<{
  id: string;
  name: string;
  setCode: string;
  category: string;
  subtype: string | null;
}>;

export type PhotoMode = "variants" | "none";

/** Which WPN product one of our products belongs to (design doc 13, section 3). */
export type WpnLink = Readonly<{
  productId: string;
  wpnName: string;
  match: "by_name" | "by_kind";
  /** "variants": show the WPN product's photos; "none": keep the generated art. */
  photo: PhotoMode;
}>;

/**
 * WPN's standard product names (after `normalizeName`), and the kinds of our products they are.
 * Everything else is matched by name.
 */
const KINDS_BY_WPN_NAME: Readonly<Record<string, readonly string[]>> = {
  "play booster": ["booster_pack/play"],
  "play booster display": ["booster_box/play"],
  "collector booster": ["booster_pack/collector"],
  "collector booster display": ["booster_box/collector"],
  "draft booster": ["booster_pack/draft"],
  "draft booster display": ["booster_box/draft"],
  "set booster": ["booster_pack/set"],
  "set booster display": ["booster_box/set"],
  "theme booster": ["booster_pack/theme"],
  "theme booster display": ["booster_box/theme"],
  "jumpstart booster": ["booster_pack/jumpstart"],
  "jumpstart booster display": ["booster_box/jumpstart"],
  bundle: ["bundle/default"],
  "gift bundle": ["bundle/gift_bundle"],
  "bundle gift edition": ["bundle/gift_bundle"],
  "prerelease pack": ["limited_aid_tool/prerelease_kit"],
  "commander deck": ["deck/commander"],
  "starter kit": ["multiple_decks/two_player_starter", "box_set/starter_deck"],
  "60 card theme deck": ["deck/theme"],
};

/** Products that are several of something (cases, "Set of 4", deck displays) never match. */
const NEVER_MATCHED_CATEGORIES = [/_case$/, /^subset$/, /^deck_box$/];
const NEVER_MATCHED_NAMES = /(^| )(case|set of)( |$)/;

/**
 * Words that say what kind of product something is. A product whose name has one of these that
 * the WPN name doesn't is a different product: "Nightmare Bundle Booster" isn't the "Nightmare
 * Bundle".
 */
const PRODUCT_TYPE_WORDS = new Set([
  "booster",
  "pack",
  "box",
  "display",
  "bundle",
  "deck",
  "kit",
  "case",
  "collection",
]);

/** Commander decks keep art featuring their own commander (design doc 13, decision 1). */
const GENERATED_ART_KINDS = new Set(["deck/commander"]);

/**
 * A name reduced to comparable words: no brand ("Magic: The Gathering®"), no set name, no
 * punctuation or trademark signs, and singular words ("Decks" → "deck", "Boxes" → "box").
 */
export function normalizeName(name: string, setName: string): string {
  const words = (text: string) =>
    text
      .replace(/[™®]/g, "") // before normalizing, which would turn "™" into "TM"
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&#39;|['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter((word) => word !== "")
      .map(singular);
  const setWords = words(setName).join(" ");
  let text = ` ${words(name).join(" ")} `;
  for (const noise of ["magic the gathering", setWords]) {
    if (noise !== "") text = text.replaceAll(` ${noise} `, " ");
  }
  return text.trim().replace(/\s+/g, " ");
}

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("xes")) return word.slice(0, -2); // boxes → box
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1); // decks → deck
  return word;
}

const kindOf = (product: ProductForMatching) =>
  `${product.category}/${product.subtype ?? "default"}`;

/**
 * Whether our product's name is this WPN name: every WPN word appears in it, in any order, and
 * it has no product-type word of its own ("Commander Decks Collector's Edition" ↔ "Commander
 * Deck Wakanda Forever Collector's Edition"; not "Nightmare Bundle" ↔ "Nightmare Bundle Booster").
 */
function nameMatches(wpnName: string, productName: string): boolean {
  const wpnWords = new Set(wpnName.split(" "));
  const productWords = productName.split(" ");
  return (
    [...wpnWords].every((word) => productWords.includes(word)) &&
    productWords.every((word) => wpnWords.has(word) || !PRODUCT_TYPE_WORDS.has(word))
  );
}

/** "Collector Booster" is plainly our "Collector Booster Pack" (not "… Minimal Packaging"). */
function isPlainly(wpnName: string, productName: string): boolean {
  return [wpnName, `${wpnName} pack`, `${wpnName} box`].includes(productName);
}

/**
 * Links our products to the WPN products on their set's page. `products` are the set's own
 * products and its Commander companion sets' (whose decks WPN lists on the main set's page).
 *
 * 1. Specific names first, by name ("Scene Box – Camp Comrades", "Pizza Bundle", "Codex
 *    Bundle"), so a generic name can't take their products.
 * 2. Then WPN's standard names by kind ("Play Booster" → every `booster_pack/play` left).
 * 3. A photo is shown when a WPN product matched exactly one of ours, or plainly one of several
 *    ("Collector Booster" ↔ "Collector Booster Pack", not its "Minimal Packaging" version). Its
 *    photos aren't labeled, so a group ("Commander Decks", five prerelease packs) can't say
 *    which is which, and keeps the generated art.
 *
 * Cases and "Set of N" products are never matched; each of our products gets at most one link.
 */
export function matchWpnProducts(
  page: WpnSetPage,
  setName: string,
  products: readonly ProductForMatching[],
): WpnLink[] {
  const normalizedNames = new Map(
    products.map((product) => [product.id, normalizeName(product.name, setName)]),
  );
  const candidates = products.filter(
    (product) =>
      !NEVER_MATCHED_CATEGORIES.some((pattern) => pattern.test(product.category)) &&
      !NEVER_MATCHED_NAMES.test(normalizedNames.get(product.id) ?? ""),
  );
  const named = page.products.map((wpnProduct) => ({
    wpnProduct,
    wpnName: normalizeName(wpnProduct.name, setName),
  }));
  const specificFirst = [
    ...named.filter(({ wpnName }) => KINDS_BY_WPN_NAME[wpnName] === undefined),
    ...named.filter(({ wpnName }) => KINDS_BY_WPN_NAME[wpnName] !== undefined),
  ];

  const claimed = new Set<string>();
  const links: WpnLink[] = [];
  for (const { wpnProduct, wpnName } of specificFirst) {
    const kinds = KINDS_BY_WPN_NAME[wpnName];
    const match: WpnLink["match"] = kinds === undefined ? "by_name" : "by_kind";
    const matched = candidates.filter(
      (product) =>
        !claimed.has(product.id) &&
        (kinds === undefined
          ? nameMatches(wpnName, normalizedNames.get(product.id) ?? "")
          : kinds.includes(kindOf(product))),
    );
    const plain = matched.filter((product) =>
      isPlainly(wpnName, normalizedNames.get(product.id) ?? ""),
    );
    const photoFor = matched.length === 1 ? matched[0] : plain.length === 1 ? plain[0] : null;

    for (const product of matched) {
      claimed.add(product.id);
      const showsPhoto =
        product === photoFor &&
        wpnProduct.images.length > 0 &&
        !GENERATED_ART_KINDS.has(kindOf(product));
      links.push({
        productId: product.id,
        wpnName: wpnProduct.name,
        match,
        photo: showsPhoto ? "variants" : "none",
      });
    }
  }
  return links;
}

/**
 * Which of a product's photo variants an owned item shows (e.g. one of three pack arts). Chosen
 * by the item's id, so the same pack always looks the same.
 */
export function variantFor(itemId: number, variantCount: number): number {
  if (variantCount <= 0) return 0;
  return ((itemId % variantCount) + variantCount) % variantCount;
}

/** A WPN price like "$24.99 " in cents, or null when it's missing or not a plain dollar price. */
export function parseMsrp(raw: string | null | undefined): number | null {
  const match = /^\s*\$\s*(\d{1,5})(?:\.(\d{2}))?\s*$/.exec(raw ?? "");
  if (match === null) return null;
  const cents = Number(match[1]) * 100 + Number(match[2] ?? "0");
  return cents > 0 ? cents : null;
}

/** Image widths we keep, per kind of image and size (design doc 13, decision 4). */
export const ARTWORK_WIDTHS = {
  product: { small: 400, large: 900 },
  keyArt: { small: 640, large: 1920 },
} as const;

export type ArtworkSize = "small" | "large";
