import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Finish } from "@/modules/catalog";
import { samplePrintingId } from "../testing/fakes";
import { copyKey, MAX_REAL_QUANTITY, sumCopies, type RealCopy } from "./copies";
import { applyPlan, isEmptyPlan, planImport, planRemoval } from "./import-plan";

const copy = (printingId: string, quantity: number, finish: Finish = "nonfoil"): RealCopy => ({
  printingId: samplePrintingId(printingId),
  finish,
  quantity,
});

/** Copies of a few printings (so they collide), as a collection holds them: one row per key. */
const copies = fc
  .array(
    fc.record({
      printingId: fc.constantFrom("a", "b", "c", "d"),
      finish: fc.constantFrom<Finish>("nonfoil", "foil"),
      quantity: fc.integer({ min: 1, max: MAX_REAL_QUANTITY }),
    }),
    { maxLength: 8 },
  )
  .map((rows) => sumCopies(rows.map((row) => copy(row.printingId, row.quantity, row.finish))));

/** A collection as a map from key to quantity, so order doesn't matter in comparisons. */
const asMap = (rows: readonly RealCopy[]) =>
  new Map(rows.map((row) => [copyKey(row), row.quantity]));

describe("planImport", () => {
  it("adds new rows and adds to existing ones, never over the maximum", () => {
    const plan = planImport(
      [copy("a", 2), copy("b", 9998)],
      [copy("a", 1), copy("b", 5), copy("c", 3)],
      "add",
    );
    expect(plan).toEqual({
      added: [copy("c", 3)],
      changed: [
        { ...copy("a", 3), from: 2 },
        { ...copy("b", MAX_REAL_QUANTITY), from: 9998 },
      ],
      removed: [],
    });
  });

  it("in replace mode, removes what the file doesn't mention and leaves equal rows alone", () => {
    const plan = planImport(
      [copy("a", 2), copy("b", 1)],
      [copy("a", 2), copy("c", 1, "foil")],
      "replace",
    );
    expect(plan).toEqual({ added: [copy("c", 1, "foil")], changed: [], removed: [copy("b", 1)] });
  });

  it("add mode never removes anything", () => {
    fc.assert(
      fc.property(copies, copies, (current, matched) => {
        expect(planImport(current, matched, "add").removed).toEqual([]);
      }),
    );
  });

  it("replace, then reading back, gives exactly the file", () => {
    fc.assert(
      fc.property(copies, copies, (current, matched) => {
        const after = applyPlan(current, planImport(current, matched, "replace"));
        expect(asMap(after)).toEqual(asMap(matched));
      }),
    );
  });

  it("importing twice: add doubles quantities (up to the maximum), replace changes nothing more", () => {
    fc.assert(
      fc.property(copies, copies, (current, matched) => {
        const once = applyPlan(current, planImport(current, matched, "add"));
        const twice = applyPlan(once, planImport(once, matched, "add"));
        for (const row of matched) {
          const before = asMap(current).get(copyKey(row)) ?? 0;
          expect(asMap(twice).get(copyKey(row))).toBe(
            Math.min(MAX_REAL_QUANTITY, before + 2 * row.quantity),
          );
        }
        const replaced = applyPlan(current, planImport(current, matched, "replace"));
        expect(isEmptyPlan(planImport(replaced, matched, "replace"))).toBe(true);
      }),
    );
  });
});

describe("planRemoval", () => {
  it("lowers rows, removes rows that reach 0, and ignores cards that aren't there", () => {
    const plan = planRemoval(
      [copy("a", 3), copy("b", 1)],
      [copy("a", 1), copy("b", 2), copy("c", 1)],
    );
    expect(plan).toEqual({
      added: [],
      changed: [{ ...copy("a", 2), from: 3 }],
      removed: [copy("b", 1)],
    });
  });
});
