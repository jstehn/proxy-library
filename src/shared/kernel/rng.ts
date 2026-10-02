/**
 * Port for randomness. Code never calls `Math.random()`: it receives an Rng, so pack
 * openings are reproducible from their seed and tests are deterministic. See ADR 0008.
 */
export interface Rng {
  /** Uniformly distributed in [0, 1). */
  next(): number;
}

export type Weighted<T> = { readonly item: T; readonly weight: number };

/**
 * Deterministic generator: the same seed always yields the same sequence.
 * Production seeds come from `randomSeed()` (shared/runtime) and are stored with each
 * opening; tests use readable seeds like "test-1".
 */
export function seededRng(seed: string): Rng {
  const [a, b, c, d] = cyrb128(seed);
  const generate = sfc32(a, b, c, d);
  for (let i = 0; i < 15; i++) generate(); // discard early outputs, which correlate with the seed
  return { next: generate };
}

/** Integer in [0, maxExclusive). */
export function randomInt(rng: Rng, maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
  }
  return Math.floor(rng.next() * maxExclusive);
}

/**
 * A shuffled copy of `items`, every order equally likely (the Fisher–Yates shuffle): walk from the
 * end, swapping each item with a random one at or before it. The input is left alone.
 */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Pick one item with probability proportional to its weight. */
export function weightedPick<T>(rng: Rng, options: ReadonlyArray<Weighted<T>>): T {
  const total = totalWeight(options);
  let remaining = rng.next() * total;
  let lastPositive: T | undefined;
  for (const { item, weight } of options) {
    if (weight === 0) continue;
    if (remaining < weight) return item;
    remaining -= weight;
    lastPositive = item;
  }
  // Only reachable through floating-point rounding at the very top of the range.
  if (lastPositive === undefined) throw new Error("unreachable: total weight is positive");
  return lastPositive;
}

/**
 * Draw `count` distinct items, one at a time, each draw proportional to weight among the
 * items not yet drawn (how a booster sheet is sampled: no duplicates within one draw).
 */
export function weightedSample<T>(
  rng: Rng,
  options: ReadonlyArray<Weighted<T>>,
  count: number,
): T[] {
  const available = options.filter((option) => option.weight > 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > available.length) {
    throw new RangeError(`cannot draw ${count} distinct items from ${available.length} options`);
  }
  const drawn: T[] = [];
  for (let i = 0; i < count; i++) {
    const index = weightedPick(
      rng,
      available.map((option, position) => ({ item: position, weight: option.weight })),
    );
    drawn.push(available[index].item);
    available.splice(index, 1);
  }
  return drawn;
}

function totalWeight(options: ReadonlyArray<Weighted<unknown>>): number {
  let total = 0;
  for (const { weight } of options) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`weights must be finite and non-negative, got ${weight}`);
    }
    total += weight;
  }
  if (total <= 0) throw new RangeError("at least one weight must be positive");
  return total;
}

/** cyrb128: hashes a string into four 32-bit seeds. */
function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: a small, fast PRNG with 128 bits of state. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
