// Reads the contents-override files (ADR 0031): one JSON file per set in a directory. They are
// data written by people, so they go through a schema and a mapper like any outside data.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ContentsOverridesSource } from "../application/ports";
import type { ContentsOverride, OverrideContent } from "../domain/contents-overrides";
import { SetCode } from "../domain/types";

const PackLine = z.strictObject({ set: z.string(), code: z.string().min(1) });
const ProductLine = z.strictObject({ name: z.string().min(1), count: z.number().int().positive() });
const DeckLine = z.strictObject({ set: z.string(), name: z.string().min(1) });
const OtherLine = z.strictObject({ name: z.string().min(1) });

/** The same shape as MTGJSON's `contents`, with `sealed` entries naming their product. */
const ProductContents = z.strictObject({
  pack: z.array(PackLine).optional(),
  sealed: z.array(ProductLine).optional(),
  deck: z.array(DeckLine).optional(),
  other: z.array(OtherLine).optional(),
});

export const ContentsOverrideFile = z.strictObject({
  set: z.string(),
  note: z.string().default(""),
  products: z.record(z.string(), ProductContents),
});
export type ContentsOverrideFile = z.infer<typeof ContentsOverrideFile>;

function mapLines(raw: z.infer<typeof ProductContents>): OverrideContent[] {
  return [
    ...(raw.pack ?? []).map((line): OverrideContent => ({
      kind: "pack",
      setCode: SetCode.of(line.set),
      boosterType: line.code,
    })),
    ...(raw.sealed ?? []).map((line): OverrideContent => ({
      kind: "product",
      productName: line.name,
      count: line.count,
    })),
    ...(raw.deck ?? []).map((line): OverrideContent => ({
      kind: "deck",
      setCode: SetCode.of(line.set),
      deckName: line.name,
    })),
    ...(raw.other ?? []).map((line): OverrideContent => ({ kind: "other", name: line.name })),
  ];
}

export function mapContentsOverrideFile(file: ContentsOverrideFile): ContentsOverride {
  return {
    setCode: SetCode.of(file.set),
    note: file.note,
    products: new Map(
      Object.entries(file.products).map(([name, contents]) => [name, mapLines(contents)]),
    ),
  };
}

/**
 * The override files in `directory`, one per set, named after the set code (`MBC.json`). No file
 * means no override. A file that can't be read, doesn't match the schema or names another set is
 * reported and skipped; it never stops the sync.
 */
export function diskContentsOverrides(directory: string): ContentsOverridesSource {
  async function forSet(code: SetCode) {
    const fileName = `${code}.json`;
    let text: string;
    try {
      text = await readFile(join(directory, fileName), "utf8");
    } catch {
      return { override: undefined, problems: [] };
    }
    try {
      const override = mapContentsOverrideFile(ContentsOverrideFile.parse(JSON.parse(text)));
      if (override.setCode !== code) {
        return {
          override: undefined,
          problems: [`contents override file ${fileName}: it says it is for ${override.setCode}`],
        };
      }
      return { override, problems: [] };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { override: undefined, problems: [`contents override file ${fileName}: ${reason}`] };
    }
  }
  return { forSet };
}
