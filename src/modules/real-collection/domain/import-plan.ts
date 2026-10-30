import { copyKey, MAX_REAL_QUANTITY, sumCopies, type RealCopy } from "./copies";

// Working out what an import changes, before anything is saved (design doc 16, section 4).
// Pure, so the preview and the import itself use the same plan (rule 6).

/** Add to what's there, or make the collection exactly the file. */
export type ImportMode = "add" | "replace";

/** A row whose quantity changes, and what it was before. */
export type ChangedCopy = RealCopy & Readonly<{ from: number }>;

/** Every change an import makes: new rows, rows with a new quantity, and rows deleted. */
export type ImportPlan = Readonly<{
  added: readonly RealCopy[];
  changed: readonly ChangedCopy[];
  removed: readonly RealCopy[];
}>;

/** A plan that changes nothing. */
export const EMPTY_PLAN: ImportPlan = { added: [], changed: [], removed: [] };

/** Whether a plan changes anything. */
export function isEmptyPlan(plan: ImportPlan): boolean {
  return plan.added.length + plan.changed.length + plan.removed.length === 0;
}

/**
 * What importing `matched` into a collection holding `current` changes. In "add" mode quantities
 * are added (up to the maximum) and nothing is removed; in "replace" mode the collection ends up
 * exactly as the import, so rows the import doesn't mention are removed.
 */
export function planImport(
  current: readonly RealCopy[],
  matched: readonly RealCopy[],
  mode: ImportMode,
): ImportPlan {
  const before = new Map(current.map((copy) => [copyKey(copy), copy]));
  const wanted = sumCopies(matched);
  const added: RealCopy[] = [];
  const changed: ChangedCopy[] = [];

  for (const copy of wanted) {
    const existing = before.get(copyKey(copy));
    if (existing === undefined) {
      added.push(copy);
      continue;
    }
    const quantity =
      mode === "add"
        ? Math.min(MAX_REAL_QUANTITY, existing.quantity + copy.quantity)
        : copy.quantity;
    if (quantity !== existing.quantity)
      changed.push({ ...copy, quantity, from: existing.quantity });
  }

  const mentioned = new Set(wanted.map(copyKey));
  const removed = mode === "replace" ? current.filter((copy) => !mentioned.has(copyKey(copy))) : [];
  return { added, changed, removed };
}

/**
 * What taking `taken` out of the collection changes (removing a real product's cards, section
 * 15, rule 13): each row goes down, and a row that would go below 1 is removed. Copies the
 * collection doesn't have are ignored.
 */
export function planRemoval(current: readonly RealCopy[], taken: readonly RealCopy[]): ImportPlan {
  const before = new Map(current.map((copy) => [copyKey(copy), copy]));
  const changed: ChangedCopy[] = [];
  const removed: RealCopy[] = [];
  for (const copy of sumCopies(taken)) {
    const existing = before.get(copyKey(copy));
    if (existing === undefined) continue;
    const quantity = existing.quantity - copy.quantity;
    if (quantity > 0) changed.push({ ...existing, quantity, from: existing.quantity });
    else removed.push(existing);
  }
  return { added: [], changed, removed };
}

/** The collection after a plan: how the fakes apply it, and what the property tests check. */
export function applyPlan(current: readonly RealCopy[], plan: ImportPlan): RealCopy[] {
  const after = new Map(current.map((copy) => [copyKey(copy), copy]));
  for (const copy of plan.removed) after.delete(copyKey(copy));
  for (const copy of [...plan.changed, ...plan.added]) {
    after.set(copyKey(copy), {
      printingId: copy.printingId,
      finish: copy.finish,
      quantity: copy.quantity,
    });
  }
  return [...after.values()];
}
