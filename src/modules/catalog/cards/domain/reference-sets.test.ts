import { describe, expect, it } from "vitest";
import { referenceSetsToImport, type ReferenceCandidate } from "./rules";
import { SetCode } from "./types";

const set = (code: string, fields: Partial<ReferenceCandidate> = {}): ReferenceCandidate => ({
  code: SetCode.of(code),
  releaseDate: "2024-01-01",
  isEnabled: false,
  isSupporting: false,
  printingsImportedAt: null,
  ...fields,
});

describe("referenceSetsToImport (design doc 16, section 7)", () => {
  it("picks sets that aren't enabled, supporting or imported yet, newest first, up to the limit", () => {
    const sets = [
      set("OLD", { releaseDate: "1999-01-01" }),
      set("NEW", { releaseDate: "2025-01-01" }),
      set("MID", { releaseDate: "2010-01-01" }),
      set("SOLD", { isEnabled: true }),
      set("SUPP", { isSupporting: true }),
      set("DONE", { printingsImportedAt: new Date("2026-10-01") }),
    ];
    expect(referenceSetsToImport(sets)).toEqual(["NEW", "MID", "OLD"]);
    expect(referenceSetsToImport(sets, 2)).toEqual(["NEW", "MID"]);
  });
});
