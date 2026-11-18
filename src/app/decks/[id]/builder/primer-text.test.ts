import { describe, expect, it } from "vitest";
import {
  formatNamedLines,
  linkedCardNames,
  parseInline,
  parseNamedLines,
  parsePrimer,
  withSuggestedSections,
} from "./primer-text";

describe("parseInline", () => {
  it("splits text into plain, bold and card runs", () => {
    expect(parseInline("Sac [[Viscera Seer]] for **value**.")).toEqual([
      { kind: "text", text: "Sac " },
      { kind: "card", name: "Viscera Seer" },
      { kind: "text", text: " for " },
      { kind: "bold", text: "value" },
      { kind: "text", text: "." },
    ]);
  });
});

describe("parsePrimer", () => {
  it("reads headings, lists and paragraphs, joining a paragraph's lines", () => {
    const blocks = parsePrimer(
      "## Plan\nBlitz value\nand recursion.\n\n- [[Avacyn, Angel of Horror]] + outlet\n- Drain\n### Note\nText",
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "heading",
      "paragraph",
    ]);
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", text: "Blitz value and recursion." }],
    });
    expect(blocks[3]).toMatchObject({ kind: "heading", level: 3 });
  });

  it("treats HTML as plain text, never markup", () => {
    expect(parsePrimer("<script>alert(1)</script>")).toEqual([
      { kind: "paragraph", content: [{ kind: "text", text: "<script>alert(1)</script>" }] },
    ]);
  });
});

describe("linkedCardNames and withSuggestedSections", () => {
  it("lists each linked card once", () => {
    expect(linkedCardNames("[[Sol Ring]] then [[Sol Ring]] and [[ Skullclamp ]]")).toEqual([
      "Sol Ring",
      "Skullclamp",
    ]);
  });

  it("adds only the suggested sections the primer lacks", () => {
    const added = withSuggestedSections("## Plan\nGo wide.");
    expect(added.startsWith("## Plan\nGo wide.\n\n## How it wins")).toBe(true);
    expect(added.match(/## Plan/g)).toHaveLength(1);
    expect(withSuggestedSections(added)).toBe(added);
    expect(withSuggestedSections("").startsWith("## Plan")).toBe(true);
  });
});

describe("named lines", () => {
  it("reads 'Card — reason' with any of the separators and writes them back", () => {
    const lines = parseNamedLines(
      "Mortuary — breaks Avacyn\nBolas's Citadel - pays life\nSkullclamp: draws\nSol Ring\n\n",
    );
    expect(lines).toEqual([
      { cardName: "Mortuary", reason: "breaks Avacyn" },
      { cardName: "Bolas's Citadel", reason: "pays life" },
      { cardName: "Skullclamp", reason: "draws" },
      { cardName: "Sol Ring", reason: "" },
    ]);
    expect(formatNamedLines(lines)).toBe(
      "Mortuary — breaks Avacyn\nBolas's Citadel — pays life\nSkullclamp — draws\nSol Ring",
    );
  });

  it("keeps hyphens inside card names", () => {
    expect(parseNamedLines("Sakura-Tribe Elder — ramp")).toEqual([
      { cardName: "Sakura-Tribe Elder", reason: "ramp" },
    ]);
  });
});
