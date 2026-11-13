import type { Format } from "./deck";

export type PackageEntrySpec = Readonly<{
  oracleId: string;
  name: string;
  quantity: number;
  heading: string | null;
  note: string | null;
  colorIdentity: readonly string[];
  legalities: Readonly<Record<string, string>>;
  isBasicLand: boolean;
}>;

export type ExistingDeckCount = Readonly<{
  oracleId: string;
  quantity: number;
}>;

export type PackageInsertItem = Readonly<{
  oracleId: string;
  name: string;
  /** Final quantity to set on the main board (existing + added). */
  finalQuantity: number;
  addedQuantity: number;
  heading: string | null;
  note: string | null;
}>;

export type PackageSkipReason = Readonly<{
  oracleId: string;
  name: string;
  reason: "illegal" | "off_color" | "at_copy_limit";
}>;

export type PackageInsertPlan = Readonly<{
  toAdd: readonly PackageInsertItem[];
  skipped: readonly PackageSkipReason[];
}>;

function maxCopiesFor(format: Format, isBasicLand: boolean): number {
  if (isBasicLand || format === "limited") return 99;
  if (format === "commander") return 1;
  return 4;
}

function isLegalInFormat(legalities: Readonly<Record<string, string>>, format: Format): boolean {
  if (format === "casual" || format === "limited") return true;
  const status = legalities[format];
  return status === "legal" || status === "restricted";
}

/**
 * Purely plans how a reusable card package merges into a deck's main board without violating
 * format legality, commander color identity, or copy limits.
 */
export function planPackageInsert(
  entries: readonly PackageEntrySpec[],
  existingMain: readonly ExistingDeckCount[],
  format: Format,
  commanderColorIdentity: readonly string[] | null,
): PackageInsertPlan {
  const existingById = new Map<string, number>();
  for (const row of existingMain) {
    existingById.set(row.oracleId, (existingById.get(row.oracleId) ?? 0) + row.quantity);
  }
  const identitySet =
    commanderColorIdentity !== null ? new Set<string>(commanderColorIdentity) : null;

  const toAdd: PackageInsertItem[] = [];
  const skipped: PackageSkipReason[] = [];

  for (const entry of entries) {
    if (entry.quantity <= 0) continue;

    if (!isLegalInFormat(entry.legalities, format)) {
      skipped.push({ oracleId: entry.oracleId, name: entry.name, reason: "illegal" });
      continue;
    }

    if (
      format === "commander" &&
      identitySet !== null &&
      entry.colorIdentity.some((c) => !identitySet.has(c))
    ) {
      skipped.push({ oracleId: entry.oracleId, name: entry.name, reason: "off_color" });
      continue;
    }

    const current = existingById.get(entry.oracleId) ?? 0;
    const cap = maxCopiesFor(format, entry.isBasicLand);
    const room = Math.max(0, cap - current);
    if (room === 0) {
      skipped.push({ oracleId: entry.oracleId, name: entry.name, reason: "at_copy_limit" });
      continue;
    }

    const addedQuantity = Math.min(entry.quantity, room);
    toAdd.push({
      oracleId: entry.oracleId,
      name: entry.name,
      finalQuantity: current + addedQuantity,
      addedQuantity,
      heading: entry.heading,
      note: entry.note,
    });
  }

  return { toAdd, skipped };
}
