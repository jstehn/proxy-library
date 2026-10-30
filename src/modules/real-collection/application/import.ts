import type { Actor } from "@/modules/accounts";
import type { PrintingId } from "@/modules/catalog";
import { err, ok, type Result } from "@/shared/kernel";
import { isValidQuantity, type RealCopy } from "../domain/copies";
import type {
  CollectionChanged,
  FinishNotAvailable,
  FormatNotRecognized,
  ImportEmpty,
  ImportTooLarge,
  PrintingNotFound,
  QuantityInvalid,
} from "../domain/errors";
import { planImport, type ImportMode, type ImportPlan } from "../domain/import-plan";
import { matchLine, type MatchedLine } from "../domain/match";
import { readImport, type ImportFormat } from "../domain/readers";
import type { CollectionVersion, RealCollectionDependencies } from "./ports";

// Importing a list or a file (design doc 16, sections 4 to 6): a preview first, then the import
// of exactly the preview the player confirmed (rule 6).

/** Rule 8: the most an import may hold. */
export const MAX_IMPORT_LINES = 20_000;
export const MAX_IMPORT_BYTES = 5_000_000;

const TOO_LARGE: ImportTooLarge = {
  kind: "ImportTooLarge",
  maxLines: MAX_IMPORT_LINES,
  maxBytes: MAX_IMPORT_BYTES,
};

export type PreviewImportInput = Readonly<{ text: string; mode: ImportMode }>;

/** What the preview shows: every line, matched or not, and what importing would change. */
export type ImportPreview = Readonly<{
  format: ImportFormat;
  mode: ImportMode;
  lines: readonly MatchedLine[];
  unreadable: readonly string[];
  plan: ImportPlan;
  /** Sent back with the import, so it fails if the collection changed in between. */
  version: CollectionVersion;
}>;

export type PreviewImportError = ImportEmpty | ImportTooLarge | FormatNotRecognized;

/** The import the player confirmed: copies with the printings as chosen in the preview. */
export type ApplyImportInput = Readonly<{
  copies: readonly RealCopy[];
  mode: ImportMode;
  version: CollectionVersion;
}>;

export type ApplyImportError =
  | ImportEmpty
  | ImportTooLarge
  | CollectionChanged
  | PrintingNotFound
  | FinishNotAvailable
  | QuantityInvalid;

/** Copies from the lines that matched, with the printing each one matched. */
export function matchedCopies(lines: readonly MatchedLine[]): RealCopy[] {
  return lines.flatMap((line) =>
    line.kind === "Matched"
      ? [{ printingId: line.printingId, finish: line.line.finish, quantity: line.line.quantity }]
      : [],
  );
}

function sameVersion(a: CollectionVersion, b: CollectionVersion): boolean {
  return a.updatedAt === b.updatedAt && a.rows === b.rows;
}

export function makeImport(dependencies: RealCollectionDependencies) {
  const { unitOfWork, clock } = dependencies;

  /** Reads and matches an import and works out its plan. Saves nothing. */
  async function previewImport(
    actor: Actor,
    input: PreviewImportInput,
  ): Promise<Result<ImportPreview, PreviewImportError>> {
    if (new TextEncoder().encode(input.text).length > MAX_IMPORT_BYTES) return err(TOO_LARGE);
    const read = readImport(input.text);
    if (!read.ok) return read;
    if (read.value.lines.length > MAX_IMPORT_LINES) return err(TOO_LARGE);
    if (read.value.lines.length === 0) return err({ kind: "ImportEmpty" });

    return unitOfWork.run<ImportPreview, PreviewImportError>(
      async ({ realCollection, printingMatcher }) => {
        const matches = await printingMatcher.candidates(read.value.lines);
        const lines = read.value.lines.map((line) => matchLine(line, matches));
        const current = await realCollection.copies(actor.userId);
        const preview: ImportPreview = {
          format: read.value.format,
          mode: input.mode,
          lines,
          unreadable: read.value.unreadable,
          plan: planImport(current, matchedCopies(lines), input.mode),
          version: await realCollection.version(actor.userId),
        };
        return ok(preview);
      },
    );
  }

  /**
   * Imports the confirmed copies, all or nothing (rule 6). The server plans again from the
   * collection as it is now, and refuses if it changed since the preview.
   */
  async function applyImport(
    actor: Actor,
    input: ApplyImportInput,
  ): Promise<Result<ImportPlan, ApplyImportError>> {
    if (input.copies.length === 0) return err({ kind: "ImportEmpty" });
    if (input.copies.length > MAX_IMPORT_LINES) return err(TOO_LARGE);
    if (input.copies.some((copy) => !isValidQuantity(copy.quantity) || copy.quantity === 0)) {
      return err({ kind: "QuantityInvalid" });
    }

    return unitOfWork.run<ImportPlan, ApplyImportError>(
      async ({ realCollection, printingMatcher }) => {
        await realCollection.lock(actor.userId);
        if (!sameVersion(await realCollection.version(actor.userId), input.version)) {
          return err({ kind: "CollectionChanged" });
        }
        const ids: PrintingId[] = [...new Set(input.copies.map((copy) => copy.printingId))];
        const facts = await printingMatcher.facts(ids);
        for (const copy of input.copies) {
          const printing = facts.get(copy.printingId);
          if (printing === undefined) return err({ kind: "PrintingNotFound" });
          if (!printing.finishes.includes(copy.finish)) {
            return err({ kind: "FinishNotAvailable", finishes: [...printing.finishes] });
          }
        }
        const plan = planImport(
          await realCollection.copies(actor.userId),
          input.copies,
          input.mode,
        );
        await realCollection.apply(actor.userId, plan, clock.now());
        return ok(plan);
      },
    );
  }

  return { previewImport, applyImport };
}
