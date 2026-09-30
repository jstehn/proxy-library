import { describe, expect, it } from "vitest";
import {
  matchWpnProducts,
  normalizeName,
  parseMsrp,
  slugCandidates,
  variantFor,
  type ProductForMatching,
  type WpnProduct,
  type WpnSetPage,
} from "./wpn";

describe("slugCandidates", () => {
  it("makes WPN's page address from the set name, then with the brand in front", () => {
    expect(slugCandidates("Secrets of Strixhaven")).toEqual([
      "secrets-of-strixhaven",
      "magic-the-gathering-secrets-of-strixhaven",
    ]);
    expect(slugCandidates("Duskmourn: House of Horror")[0]).toBe("duskmourn-house-of-horror");
    expect(slugCandidates("Marvel's Spider-Man")[0]).toBe("marvels-spider-man");
    expect(slugCandidates("Avatar: The Last Airbender")[1]).toBe(
      "magic-the-gathering-avatar-the-last-airbender",
    );
    expect(slugCandidates("FINAL FANTASY™")[0]).toBe("final-fantasy");
    expect(slugCandidates("The Lord of the Rings: Tales of Middle-earth™")[0]).toBe(
      "the-lord-of-the-rings-tales-of-middle-earth",
    );
    expect(slugCandidates("!!!")).toEqual([]);
  });
});

describe("normalizeName", () => {
  it("drops the brand, the set name, punctuation and plurals", () => {
    expect(
      normalizeName("Magic: The Gathering®—FINAL FANTASY™ Play Booster", "Final Fantasy"),
    ).toBe("play booster");
    expect(normalizeName("Scene Boxes", "Final Fantasy")).toBe("scene box");
    expect(normalizeName("Commanders&#39; Decks – Collector&#39;s Edition", "X")).toBe(
      "commander deck collector edition",
    );
    expect(normalizeName("Edge of Eternities Commander Decks", "Edge of Eternities")).toBe(
      "commander deck",
    );
  });
});

describe("parseMsrp", () => {
  it("reads WPN's prices, and refuses anything that isn't a plain dollar price", () => {
    expect(parseMsrp("$24.99 ")).toBe(2499);
    expect(parseMsrp(" $149.99")).toBe(14999);
    expect(parseMsrp("$5")).toBe(500);
    expect(parseMsrp("€24.99")).toBeNull();
    expect(parseMsrp("TBD")).toBeNull();
    expect(parseMsrp("$0.00")).toBeNull();
    expect(parseMsrp(null)).toBeNull();
  });
});

describe("variantFor", () => {
  it("picks the same variant for the same item, spread across the variants", () => {
    expect(variantFor(7, 3)).toBe(1);
    expect(variantFor(7, 3)).toBe(variantFor(7, 3));
    expect(new Set([1, 2, 3, 4, 5, 6].map((id) => variantFor(id, 3)))).toEqual(new Set([0, 1, 2]));
    expect(variantFor(5, 0)).toBe(0);
  });
});

function wpn(name: string, imageCount = 1): WpnProduct {
  return {
    name,
    releaseDate: "2026-04-24",
    msrpCents: null,
    description: null,
    contents: [],
    images: Array.from({ length: imageCount }, (_, index) => ({
      id: `${name}-${index}`,
      url: `//images.ctfassets.net/0piqveu8x9oj/${index}/x/y.png`,
    })),
  };
}

function ours(
  id: string,
  name: string,
  category: string,
  subtype: string | null,
  setCode = "SOS",
): ProductForMatching {
  return { id, name, setCode, category, subtype };
}

describe("matchWpnProducts", () => {
  // Real names from Secrets of Strixhaven's WPN page and our catalog (2026-09-30).
  const page: WpnSetPage = {
    slug: "secrets-of-strixhaven",
    keyArt: null,
    products: [
      wpn("Prerelease Pack", 5),
      wpn("Play Booster", 3),
      wpn("Play Booster Display"),
      wpn("Collector Booster"),
      wpn("Commander Decks", 5),
      wpn("Bundle"),
      wpn("Codex Bundle"),
      wpn("Draft Night"),
      wpn("60-Card Theme Deck", 2),
    ],
  };
  const products = [
    ours("pack", "Secrets of Strixhaven Play Booster Pack", "booster_pack", "play"),
    ours("box", "Secrets of Strixhaven Play Booster Box", "booster_box", "play"),
    ours("case", "Secrets of Strixhaven Play Booster Box Case", "booster_case", "play"),
    ours("collector", "Secrets of Strixhaven Collector Booster Pack", "booster_pack", "collector"),
    ours("bundle", "Secrets of Strixhaven Bundle", "bundle", null),
    ours("codex", "Secrets of Strixhaven Codex Bundle", "bundle", "unknown"),
    ours("night", "Secrets of Strixhaven Draft Night", "limited_aid_tool", "draft"),
    ours("theme-1", "Secrets of Strixhaven 60-Card Theme Deck Lorehold", "deck", "theme"),
    ours("theme-2", "Secrets of Strixhaven 60-Card Theme Deck Quandrix", "deck", "theme"),
    ours("set-of-2", "Secrets of Strixhaven Theme Decks Set of 2", "subset", "theme"),
    ours("cmdr", "Silverquill Influence", "deck", "commander", "SOC"),
    ours("welcome", "Secrets of Strixhaven Welcome Deck Black Deck", "deck", "welcome"),
  ];
  const links = matchWpnProducts(page, "Secrets of Strixhaven", products);
  const linkFor = (id: string) => links.find((link) => link.productId === id);

  it("matches WPN's standard names by kind, with photos for one-to-one matches", () => {
    expect(linkFor("pack")).toEqual({
      productId: "pack",
      wpnName: "Play Booster",
      match: "by_kind",
      photo: "variants",
    });
    expect(linkFor("box")?.wpnName).toBe("Play Booster Display");
    expect(linkFor("bundle")?.wpnName).toBe("Bundle");
  });

  it("matches other names by name", () => {
    expect(linkFor("codex")).toMatchObject({ wpnName: "Codex Bundle", match: "by_name" });
    expect(linkFor("night")).toMatchObject({ wpnName: "Draft Night", photo: "variants" });
  });

  it("links a group for its price and details, but shows no photo it can't tell apart", () => {
    expect(linkFor("theme-1")).toMatchObject({ wpnName: "60-Card Theme Deck", photo: "none" });
    expect(linkFor("theme-2")).toMatchObject({ photo: "none" });
  });

  it("keeps Commander decks' own art, but links them (from the companion set) for the MSRP", () => {
    expect(linkFor("cmdr")).toMatchObject({ wpnName: "Commander Decks", photo: "none" });
  });

  it("never matches cases, sets of several, or products WPN doesn't list", () => {
    expect(linkFor("case")).toBeUndefined();
    expect(linkFor("set-of-2")).toBeUndefined();
    expect(linkFor("welcome")).toBeUndefined();
  });

  it("picks the closest name when several contain it", () => {
    const dsk: WpnSetPage = { slug: "d", keyArt: null, products: [wpn("Nightmare Bundle")] };
    const matched = matchWpnProducts(dsk, "Duskmourn: House of Horror", [
      ours("nb", "Duskmourn House of Horror Nightmare Bundle", "bundle", "premium", "DSK"),
      ours("nbb", "Duskmourn House of Horror Nightmare Bundle Booster", "booster_pack", "premium"),
    ]);
    expect(matched.map((link) => link.productId)).toEqual(["nb"]);
  });

  it("matches a named scene box to its own product (Final Fantasy)", () => {
    const fin: WpnSetPage = {
      slug: "final-fantasy",
      keyArt: null,
      products: [wpn("Magic: The Gathering®—FINAL FANTASY™ Scene Box – Camp Comrades")],
    };
    const matched = matchWpnProducts(fin, "Final Fantasy", [
      ours("camp", "Final Fantasy Scene Box Camp Comrades", "box_set", "other", "FIN"),
      ours("fate", "Final Fantasy Scene Box Children of Fate", "box_set", "other", "FIN"),
      ours("four", "Final Fantasy Scene Box Set of 4", "subset", "other", "FIN"),
    ]);
    expect(matched).toEqual([
      {
        productId: "camp",
        wpnName: "Magic: The Gathering®—FINAL FANTASY™ Scene Box – Camp Comrades",
        match: "by_name",
        photo: "variants",
      },
    ]);
  });
});
