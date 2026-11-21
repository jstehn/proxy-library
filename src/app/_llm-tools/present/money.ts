// Shapes shared by the bindings' `present` functions: the model gets money as plain cents.

/** The value without its `provenance` header (heuristic outputs carry one for other callers). */
export function stripProvenance(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { value };
  }
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.provenance;
  return copy;
}

/** Every `{ cents, text }` in the value becomes its plain cents; `provenance` keys are dropped. */
export function compactMoneyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactMoneyFields);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length === 2 &&
    typeof record.cents === "number" &&
    typeof record.text === "string"
  ) {
    return record.cents;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === "provenance") continue;
    out[k] = compactMoneyFields(v);
  }
  return out;
}
