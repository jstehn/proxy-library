import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contentsLines,
  fixtureWpnGateway,
  parseWpnPage,
  plainText,
  wpnImage,
  WpnPageUnreadable,
} from "./wpn";

// Recorded WPN pages (tests/fixtures/wpn, 2026-09-30). Never the network.
const page = (slug: string) =>
  parseWpnPage(readFileSync(`tests/fixtures/wpn/${slug}.html`, "utf8"), slug);

describe("parseWpnPage", () => {
  const sos = page("secrets-of-strixhaven");

  it("reads every product on the page", () => {
    expect(sos.products.map((product) => product.name).sort()).toEqual([
      "60-Card Theme Deck",
      "Bundle",
      "Codex Bundle",
      "Collector Booster",
      "Collector Booster Display",
      "Commander Decks",
      "Draft Night",
      "Play Booster",
      "Play Booster Display",
      "Prerelease Pack",
    ]);
  });

  it("reads MSRPs, release dates and every photo variant", () => {
    const codex = sos.products.find((product) => product.name === "Codex Bundle");
    expect(codex).toMatchObject({ msrpCents: 8999, releaseDate: "2026-05-15" });
    const play = sos.products.find((product) => product.name === "Play Booster");
    expect(play?.images).toHaveLength(3); // three pack arts
    expect(play?.images[0].id).toMatch(/^[A-Za-z0-9]+-[a-f0-9]{12}$/);
    // Displays have no MSRP on WPN.
    expect(sos.products.find((p) => p.name === "Play Booster Display")?.msrpCents).toBeNull();
  });

  it("keeps descriptions and contents as plain text, never HTML", () => {
    const collector = sos.products.find((product) => product.name === "Collector Booster");
    expect(collector?.contents[0]).toEqual({ depth: 0, text: "15 Magic: The Gathering cards" });
    const everything = JSON.stringify(sos.products);
    expect(everything).not.toMatch(/<[a-z/][^>]*>/i);
    expect(everything).not.toContain("fit-box-mobile"); // CSS some descriptions carry
  });

  it("reads the key art from the page's header", () => {
    expect(sos.keyArt?.url).toMatch(/SOS_prodpage_header\.jpg$/);
  });

  it("reads a page with many named products (Final Fantasy)", () => {
    const fin = page("final-fantasy");
    expect(fin.products).toHaveLength(16);
    const sceneBoxes = fin.products.filter((product) => product.name.includes("Scene Box"));
    expect(sceneBoxes.map((product) => product.msrpCents)).toEqual([4199, 4199, 4199, 4199]);
  });

  it("reads an older page whose products have no contents (Innistrad: Midnight Hunt, 2021)", () => {
    const mid = page("innistrad-midnight-hunt");
    expect(mid.products.map((product) => product.name)).toContain(
      "Innistrad: Midnight Hunt Set Boosters",
    );
    expect(mid.products).toHaveLength(11);
    expect(mid.products.every((product) => product.images.length > 0)).toBe(true);
    expect(mid.products.some((product) => product.description !== null)).toBe(true);
  });

  it("refuses a page whose shape changed, rather than guessing", () => {
    expect(() => parseWpnPage("<html><body>Redesigned!</body></html>", "x")).toThrow(
      WpnPageUnreadable,
    );
    const noProducts = '<script id="__NUXT_DATA__" type="application/json">[{"a":1},"b"]</script>';
    expect(() => parseWpnPage(noProducts, "x")).toThrow(/no products/);
  });
});

describe("wpnImage", () => {
  it("accepts only Wizards' image host, in WPN's space (rule 1)", () => {
    expect(
      wpnImage("//images.ctfassets.net/0piqveu8x9oj/2yEYxLO1czzwM52tPKlpAl/bfdaf1dc84271a/p.png"),
    ).toEqual({
      id: "2yEYxLO1czzwM52tPKlpAl-bfdaf1dc8427",
      url: "//images.ctfassets.net/0piqveu8x9oj/2yEYxLO1czzwM52tPKlpAl/bfdaf1dc84271a/p.png",
    });
    expect(wpnImage("//images.ctfassets.net/otherSpace/abc/def123/p.png")).toBeNull();
    expect(wpnImage("https://m.media-amazon.com/images/I/81abc.jpg")).toBeNull();
    expect(wpnImage("//images.ctfassets.net/0piqveu8x9oj/a/b1/../../x.png")).toBeNull();
  });
});

describe("plain text", () => {
  it("turns HTML into text, dropping style blocks and decoding entities", () => {
    expect(
      plainText("<style>.x{color:red}</style><p>It&#39;s a <b>draft</b> party!</p><p>Go</p>"),
    ).toBe("It's a draft party!\nGo");
    expect(plainText(undefined)).toBeNull();
    expect(plainText("<p> </p>")).toBeNull();
  });

  it("keeps a nested list's structure as depths", () => {
    expect(
      contentsLines("<ul><li>12 boosters<ul><li>15 cards each</li></ul></li><li>Die</li></ul>"),
    ).toEqual([
      { depth: 0, text: "12 boosters" },
      { depth: 1, text: "15 cards each" },
      { depth: 0, text: "Die" },
    ]);
  });
});

describe("fixtureWpnGateway", () => {
  it("serves recorded pages, treats others as missing, and never downloads", async () => {
    const gateway = fixtureWpnGateway();
    expect((await gateway.setPage("bloomburrow"))?.products.length).toBeGreaterThan(0);
    expect(await gateway.setPage("no-such-set")).toBeNull();
    const bytes = await gateway.image({ id: "a-1", url: "//x" }, 400);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF"); // a WebP file
  });
});
