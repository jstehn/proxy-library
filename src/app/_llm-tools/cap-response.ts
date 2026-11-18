export const MAX_TOOL_RESPONSE_BYTES = 40_000;

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findLargestArrayKey(obj: Record<string, unknown>): string | null {
  let bestKey: string | null = null;
  let bestBytes = 0;
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val) && val.length > 0) {
      const bytes = jsonBytes(val);
      if (bytes > bestBytes) {
        bestBytes = bytes;
        bestKey = key;
      }
    }
  }
  return bestKey;
}

/**
 * Caps any tool response at `MAX_TOOL_RESPONSE_BYTES` (~40 KB) by paginating the largest array
 * field with a `next` cursor rather than truncating mid-JSON. If secondary fields still push the
 * payload over the limit, bulky secondary fields are omitted with `omittedFields` listed.
 */
export function capToolResponse<T>(value: T, cursor = 0): T {
  const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
  if (safeCursor === 0 && jsonBytes(value) <= MAX_TOOL_RESPONSE_BYTES) {
    return value;
  }

  if (Array.isArray(value)) {
    return paginateArray(value, safeCursor, (slice, meta) => ({
      items: slice,
      ...meta,
    })) as unknown as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const arrayKey = findLargestArrayKey(value);
  if (arrayKey === null) {
    return shrinkOversizedObject(value) as T;
  }

  const fullArray = value[arrayKey] as unknown[];
  const base: Record<string, unknown> = { ...value };

  const paginated = paginateArray(fullArray, safeCursor, (slice, meta) => ({
    ...base,
    [arrayKey]: slice,
    ...meta,
  }));

  if (jsonBytes(paginated) <= MAX_TOOL_RESPONSE_BYTES) {
    return paginated as T;
  }

  // Secondary fields alone exceed the budget; trim secondary bulky fields and re-paginate.
  const trimmedBase = shrinkOversizedObject(base, arrayKey);
  return paginateArray(fullArray, safeCursor, (slice, meta) => ({
    ...trimmedBase,
    [arrayKey]: slice,
    ...meta,
  })) as unknown as T;
}

function paginateArray<R>(
  items: unknown[],
  offset: number,
  build: (
    slice: unknown[],
    meta: { next?: number; totalCount: number; truncatedByCap: true },
  ) => R,
): R {
  const start = Math.min(offset, items.length);
  const remaining = items.slice(start);
  const totalCount = items.length;

  if (remaining.length === 0) {
    return build([], { totalCount, truncatedByCap: true });
  }

  // Binary search the largest prefix of `remaining` that fits within MAX_TOOL_RESPONSE_BYTES.
  let lo = 1;
  let hi = remaining.length;
  let best = 0;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const nextOffset = start + mid;
    const candidate = build(remaining.slice(0, mid), {
      ...(nextOffset < totalCount ? { next: nextOffset } : {}),
      totalCount,
      truncatedByCap: true,
    });
    if (jsonBytes(candidate) <= MAX_TOOL_RESPONSE_BYTES) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const count = Math.max(0, best);
  const nextOffset = start + count;
  return build(remaining.slice(0, count), {
    ...(nextOffset < totalCount && count > 0 ? { next: nextOffset } : {}),
    totalCount,
    truncatedByCap: true,
  });
}

function shrinkOversizedObject(
  obj: Record<string, unknown>,
  preserveKey?: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  const omitted: string[] = [];

  // Sort other keys by byte size descending and drop until under half the budget
  // so the primary paginated array still has room.
  const candidates = Object.keys(copy)
    .filter((k) => k !== preserveKey && k !== "omittedFields" && k !== "truncatedByCap")
    .map((k) => ({ key: k, bytes: jsonBytes(copy[k]) }))
    .sort((a, b) => b.bytes - a.bytes);

  const targetBytes = preserveKey ? Math.floor(MAX_TOOL_RESPONSE_BYTES * 0.5) : MAX_TOOL_RESPONSE_BYTES;
  for (const { key } of candidates) {
    if (jsonBytes(copy) <= targetBytes) break;
    delete copy[key];
    omitted.push(key);
  }

  if (omitted.length > 0) {
    copy.omittedFields = omitted;
    copy.truncatedByCap = true;
  }
  return copy;
}
