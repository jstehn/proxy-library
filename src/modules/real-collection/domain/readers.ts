import Papa from "papaparse";
import type { Finish } from "@/modules/catalog";
import { parseList, type ListSection } from "@/shared/card-search";
import { err, ok, type Result } from "@/shared/kernel";
import { MAX_REAL_QUANTITY } from "./copies";
import type { FormatNotRecognized } from "./errors";

// Reading what a player imports (design doc 16, section 4): a pasted list, or a collection
// app's CSV file. One reader per format, all with the same shape (the Strategy pattern, as the
// exporters do). CSV files go through a CSV library, because quoted fields with commas and line
// breaks are easy to get wrong by hand. Condition and language columns are ignored.

/** One line of an import, read but not yet matched to the catalog. */
export type ImportLine = Readonly<{
  /** Its place in the import, from 0, so the preview can refer to it. */
  index: number;
  quantity: number;
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
  /** ManaBox files have it, so the match is exact. */
  scryfallId: string | null;
  /** Nonfoil unless the line says otherwise. */
  finish: Finish;
  /** A pasted deck list's section ("Commander", "Sideboard"); "main" for collection files. */
  board: ImportBoard;
}>;

/** The sections a real import keeps: a maybeboard isn't cards you have. */
export type ImportBoard = Exclude<ListSection, "maybe">;

export type ImportFormat = "list" | "moxfield" | "manabox" | "ours";

/** What reading produced: the lines, and the lines that couldn't be read (rule 7). */
export type ReadImport = Readonly<{
  format: ImportFormat;
  lines: readonly ImportLine[];
  unreadable: readonly string[];
}>;

/** One CSV row, by its header names. */
type CsvRow = Readonly<Record<string, string | undefined>>;

/** A row's fields as an ImportLine (without its index), or null if it can't be read. */
type RowReader = (row: CsvRow) => Omit<ImportLine, "index"> | null;

type CsvFormat = Readonly<{
  /** Whether a file with these (lowercased) header names is in this format. */
  recognizes: (headers: ReadonlySet<string>) => boolean;
  read: RowReader;
}>;

/** A quantity from a file: a whole number from 1 to the maximum, or null. */
function quantityOf(text: string | undefined): number | null {
  const quantity = Number((text ?? "").trim());
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= MAX_REAL_QUANTITY
    ? quantity
    : null;
}

/** A finish column: "foil" and "etched" as themselves, anything else ("", "normal") nonfoil. */
function finishOf(text: string | undefined): Finish {
  const value = (text ?? "").trim().toLowerCase();
  return value === "foil" || value === "etched" ? value : "nonfoil";
}

/** A text column, trimmed, or null when it's empty. */
function textOf(text: string | undefined): string | null {
  const value = (text ?? "").trim();
  return value === "" ? null : value;
}

/** Builds a line from the fields every format has, or null without a name or quantity. */
function lineFrom(fields: {
  quantity: string | undefined;
  name: string | undefined;
  setCode: string | undefined;
  collectorNumber: string | undefined;
  scryfallId?: string;
  finish: string | undefined;
}): Omit<ImportLine, "index"> | null {
  const quantity = quantityOf(fields.quantity);
  const name = textOf(fields.name);
  if (quantity === null || name === null) return null;
  return {
    quantity,
    name,
    setCode: textOf(fields.setCode)?.toUpperCase() ?? null,
    collectorNumber: textOf(fields.collectorNumber),
    scryfallId: textOf(fields.scryfallId)?.toLowerCase() ?? null,
    finish: finishOf(fields.finish),
    board: "main",
  };
}

const CSV_FORMATS: Readonly<Record<Exclude<ImportFormat, "list">, CsvFormat>> = {
  /** ManaBox's export: the Scryfall id makes the match exact. */
  manabox: {
    recognizes: (headers) => headers.has("manabox id") && headers.has("scryfall id"),
    read: (row) =>
      lineFrom({
        quantity: row["Quantity"],
        name: row["Name"],
        setCode: row["Set code"],
        collectorNumber: row["Collector number"],
        scryfallId: row["Scryfall ID"],
        finish: row["Foil"],
      }),
  },
  /** Moxfield's collection CSV (also what our "Moxfield" export writes). */
  moxfield: {
    recognizes: (headers) => headers.has("count") && headers.has("name") && headers.has("edition"),
    read: (row) =>
      lineFrom({
        quantity: row["Count"],
        name: row["Name"],
        setCode: row["Edition"],
        collectorNumber: row["Collector Number"],
        finish: row["Foil"],
      }),
  },
  /** Our own "full" export. */
  ours: {
    recognizes: (headers) =>
      ["set", "number", "name", "finish", "quantity"].every((name) => headers.has(name)),
    read: (row) =>
      lineFrom({
        quantity: row["Quantity"],
        name: row["Name"],
        setCode: row["Set"],
        collectorNumber: row["Number"],
        finish: row["Finish"],
      }),
  },
};

/** The header names of a CSV's first line, lowercased. */
function headersOf(firstLine: string): string[] {
  const parsed = Papa.parse<string[]>(firstLine, { header: false });
  return (parsed.data[0] ?? []).map((name) => name.trim().toLowerCase());
}

/** Reads a CSV file in a known format; each row the format can't read is listed as unreadable. */
function readCsv(text: string, format: CsvFormat, name: ImportFormat): ReadImport {
  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const lines: ImportLine[] = [];
  const unreadable: string[] = [];
  parsed.data.forEach((row, rowIndex) => {
    const line = format.read(row);
    // Row 1 is the header, so data rows start at line 2.
    if (line === null) unreadable.push(`Line ${rowIndex + 2}: ${Object.values(row).join(", ")}`);
    else lines.push({ ...line, index: lines.length });
  });
  return { format: name, lines, unreadable };
}

/** Reads a pasted list with the deck importer's parser, quantities up to the maximum. */
function readList(text: string): ReadImport {
  const parsed = parseList(text, { maxQuantity: MAX_REAL_QUANTITY });
  // parseList leaves a maybeboard out unless asked; this tells TypeScript so too.
  const lines = parsed.lines.flatMap((line, index): ImportLine[] =>
    line.board === "maybe"
      ? []
      : [
          {
            index,
            quantity: line.quantity,
            name: line.name,
            setCode: line.setCode,
            collectorNumber: line.collectorNumber,
            scryfallId: null,
            finish: line.finish ?? "nonfoil",
            board: line.board,
          },
        ],
  );
  return { format: "list", lines, unreadable: parsed.unreadable };
}

/**
 * Reads an import, working out its format from the first line: a known CSV header, or else a
 * pasted list. A first line that looks like some other CSV header (three or more fields, not
 * starting with a quantity) is a file in a format we don't read.
 */
export function readImport(text: string): Result<ReadImport, FormatNotRecognized> {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const headers = headersOf(firstLine);
  const headerSet = new Set(headers);
  for (const [name, format] of Object.entries(CSV_FORMATS)) {
    if (format.recognizes(headerSet)) return ok(readCsv(text, format, name as ImportFormat));
  }
  const looksLikeCsv = headers.length >= 3 && !/^\s*\d/.test(firstLine);
  if (looksLikeCsv) return err({ kind: "FormatNotRecognized" });
  return ok(readList(text));
}
