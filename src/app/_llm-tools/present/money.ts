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
  const obj = value as Record<string, unknown>;
  if (
    Object.keys(obj).length === 2 &&
    typeof obj.cents === "number" &&
    typeof obj.text === "string"
  ) {
    return obj.cents;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "provenance") continue;
    out[k] = compactMoneyFields(v);
  }
  return out;
}
