import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SealedProductId, SetCode } from "../domain/types";
import { diskContentsOverrides } from "./contents-overrides";
import { applyContentsOverride } from "../domain/contents-overrides";

const MBC = SetCode.of("MBC");

async function directoryWith(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "overrides-"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(directory, name), text);
  return directory;
}

describe("diskContentsOverrides (ADR 0031)", () => {
  it("reads a set's file and turns names and set codes into domain values", async () => {
    const directory = await directoryWith({
      "MBC.json": JSON.stringify({
        set: "mbc",
        products: {
          Pack: { pack: [{ set: "mbc", code: "draft" }] },
          Box: { sealed: [{ name: "Pack", count: 24 }] },
        },
      }),
    });
    const { override, problems } = await diskContentsOverrides(directory).forSet(MBC);
    expect(problems).toEqual([]);
    expect(override?.setCode).toBe("MBC");
    expect(override?.products.get("Pack")).toEqual([
      { kind: "pack", setCode: MBC, boosterType: "draft" },
    ]);
    expect(override?.products.get("Box")).toEqual([
      { kind: "product", productName: "Pack", count: 24 },
    ]);
  });

  it("has no override for a set without a file or a directory", async () => {
    const empty = await directoryWith({});
    expect(await diskContentsOverrides(empty).forSet(MBC)).toEqual({
      override: undefined,
      problems: [],
    });
    expect(await diskContentsOverrides(join(empty, "missing")).forSet(MBC)).toEqual({
      override: undefined,
      problems: [],
    });
  });

  it("reports a file that is broken, misnamed or has unknown keys, without throwing", async () => {
    const directory = await directoryWith({
      "MBC.json":
        '{ "set": "MBC", "products": { "Box": { "sealed": [{ "name": "P", "count": 0 }] } } }',
      "MB2.json": '{ "set": "MBC", "products": {} }',
      "MB1.json": "not json",
      "CMB1.json": '{ "set": "CMB1", "products": { "X": { "card": [] } } }',
    });
    const source = diskContentsOverrides(directory);
    for (const code of ["MBC", "MB2", "MB1", "CMB1"]) {
      const { override, problems } = await source.forSet(SetCode.of(code));
      expect(override).toBeUndefined();
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${code}.json`);
    }
  });

  it("the bundled MBC file is valid and gives a pack and a box contents", async () => {
    const { override, problems } = await diskContentsOverrides("data/sealed-contents").forSet(MBC);
    expect(problems).toEqual([]);
    const names = [
      "Mystery Booster Commander Edition Booster Pack",
      "Mystery Booster Commander Edition Booster Box",
    ];
    const products = names.map((name) => ({
      id: SealedProductId.of(name),
      setCode: MBC,
      name,
      category: "booster_pack",
      subtype: "draft_set",
      releaseDate: null,
      contents: [],
    }));
    const result = applyContentsOverride({ products } as never, override);
    expect(result.problems).toEqual([]);
    expect(result.applied).toEqual(names);
    expect(await readFile("data/sealed-contents/MBC.json", "utf8")).toContain("24");
  });
});
