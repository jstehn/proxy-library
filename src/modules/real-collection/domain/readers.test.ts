import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readImport, type ImportLine } from "./readers";

const fixture = (name: string) => readFileSync(`tests/fixtures/real-collection/${name}`, "utf8");

/** A line as readImport makes it, with the fields a test doesn't care about filled in. */
function line(
  fields: Partial<ImportLine> & Pick<ImportLine, "index" | "quantity" | "name">,
): ImportLine {
  return {
    setCode: null,
    collectorNumber: null,
    scryfallId: null,
    finish: "nonfoil",
    board: "main",
    ...fields,
  };
}

function read(text: string) {
  const result = readImport(text);
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
}

describe("readImport", () => {
  it("reads a ManaBox file by Scryfall id, quoted names, finishes, and skips broken rows", () => {
    const imported = read(fixture("manabox.csv"));
    expect(imported.format).toBe("manabox");
    expect(imported.lines.slice(0, 3)).toEqual([
      line({
        index: 0,
        quantity: 1,
        name: "Beza, the Bounding Spring",
        setCode: "BLB",
        collectorNumber: "2",
        scryfallId: "fc310a26-b6a0-4e42-98ab-bdfd7b06cb63",
        finish: "foil",
      }),
      line({
        index: 1,
        quantity: 4,
        name: "Banishing Light",
        setCode: "BLB",
        collectorNumber: "1",
        scryfallId: "25a06f82-ebdb-4dd6-bfe8-958018ce557c",
      }),
      line({
        index: 2,
        quantity: 1,
        name: "Beza, the Bounding Spring",
        setCode: "PBLB",
        collectorNumber: "2p",
        scryfallId: "ff94a960-f9f4-4787-a844-b02837a2ec0b",
      }),
    ]);
    expect(imported.lines).toHaveLength(4); // the unknown card is read; matching skips it
    expect(imported.unreadable).toEqual([expect.stringMatching(/^Line 6: Carrot Cake/)]);
  });

  it("reads a Moxfield collection file, ignoring condition and language", () => {
    const imported = read(fixture("moxfield.csv"));
    expect(imported.format).toBe("moxfield");
    expect(
      imported.lines.map((each) => [
        each.quantity,
        each.name,
        each.setCode,
        each.collectorNumber,
        each.finish,
      ]),
    ).toEqual([
      [2, "Dawn's Truce", "BLB", "9", "nonfoil"],
      [1, "Dawn's Truce", "BLB", "295", "foil"],
      [3, "Caretaker's Talent", "BLB", null, "nonfoil"],
      [1, "Serra Redeemer", "BLB", "387", "foil"],
    ]);
    expect(imported.unreadable).toEqual([]);
  });

  it("reads our own full export", () => {
    const imported = read(fixture("ours.csv"));
    expect(imported.format).toBe("ours");
    expect(imported.lines).toEqual([
      line({
        index: 0,
        quantity: 2,
        name: "Banishing Light",
        setCode: "BLB",
        collectorNumber: "1",
      }),
      line({
        index: 1,
        quantity: 1,
        name: "Caretaker's Talent",
        setCode: "BLB",
        collectorNumber: "6",
        finish: "foil",
      }),
    ]);
  });

  it("reads a pasted deck list with boards, markers and quantities over 99", () => {
    const imported = read(fixture("list.txt"));
    expect(imported.format).toBe("list");
    expect(
      imported.lines.map((each) => [each.quantity, each.name, each.finish, each.board]),
    ).toEqual([
      [1, "Beza, the Bounding Spring", "nonfoil", "commander"],
      [4, "Banishing Light", "nonfoil", "main"],
      [1, "Dawn's Truce", "foil", "main"],
      [250, "Plains", "nonfoil", "main"],
      [2, "Carrot Cake", "nonfoil", "main"],
      [1, "Lumra, Bellow of the Woods", "nonfoil", "main"],
      [1, "Brave-Kin Duo", "nonfoil", "side"],
    ]);
    expect(imported.lines[2]).toMatchObject({ setCode: "BLB", collectorNumber: "295" });
    expect(imported.unreadable).toEqual(["0 Brightblade Stoat"]);
  });

  it("refuses a CSV file in a format it doesn't know", () => {
    expect(readImport(fixture("unknown.csv"))).toEqual({
      ok: false,
      error: { kind: "FormatNotRecognized" },
    });
  });

  it("treats a list of names with commas as a list, not a CSV", () => {
    expect(read("Beza, the Bounding Spring\n1 Ajani, Caller of the Pride").format).toBe("list");
  });
});
