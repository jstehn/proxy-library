// Exporting a collection (design doc 11, section 3): one shape for every format (Strategy), and
// one function that quotes CSV fields correctly.

export type ExportRow = Readonly<{
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: "nonfoil" | "foil" | "etched";
  rarity: string;
  quantity: number;
  priceCents: number | null;
  firstAcquired: string; // ISO date
  lastAcquired: string;
}>;

export type CollectionExporter = (rows: readonly ExportRow[]) => string;

/**
 * One CSV field. A field containing a comma, a quote or a line break is wrapped in quotes, and
 * quotes inside it are doubled ("Urza's ""Saga""" style), so every spreadsheet reads it back.
 */
export function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(
  header: readonly string[],
  lines: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  return [header, ...lines].map((line) => line.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export const COLLECTION_EXPORTERS: Readonly<
  Record<"moxfield" | "text" | "full", CollectionExporter>
> = {
  /** Moxfield's collection import CSV. We don't track condition or language, so they're fixed. */
  moxfield: (rows) =>
    csv(
      [
        "Count",
        "Tradelist Count",
        "Name",
        "Edition",
        "Condition",
        "Language",
        "Foil",
        "Tags",
        "Last Modified",
        "Collector Number",
        "Alter",
        "Proxy",
        "Purchase Price",
      ],
      rows.map((row) => [
        row.quantity,
        0,
        row.name,
        row.setCode.toLowerCase(),
        "Near Mint",
        "English",
        row.finish === "nonfoil" ? "" : row.finish,
        "",
        row.lastAcquired.slice(0, 10),
        row.collectorNumber,
        "False",
        "False",
        "",
      ]),
    ),

  /** "4 Lightning Bolt (M11) 149", with *F* for foil and *E* for etched, one card per line. */
  text: (rows) =>
    rows
      .map((row) => {
        const finish = row.finish === "foil" ? " *F*" : row.finish === "etched" ? " *E*" : "";
        return `${row.quantity} ${row.name} (${row.setCode}) ${row.collectorNumber}${finish}`;
      })
      .join("\n") + "\n",

  /** Everything we know, for spreadsheets. */
  full: (rows) =>
    csv(
      [
        "Set",
        "Number",
        "Name",
        "Finish",
        "Rarity",
        "Quantity",
        "Market price (USD)",
        "Total value (USD)",
        "First acquired",
        "Last acquired",
      ],
      rows.map((row) => [
        row.setCode,
        row.collectorNumber,
        row.name,
        row.finish,
        row.rarity,
        row.quantity,
        dollars(row.priceCents),
        dollars(row.priceCents === null ? null : row.priceCents * row.quantity),
        row.firstAcquired.slice(0, 10),
        row.lastAcquired.slice(0, 10),
      ]),
    ),
};
