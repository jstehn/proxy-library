// Pure EDHREC domain types and helpers (design doc 45, section 3).

export type EdhrecCardEntry = Readonly<{
  cardName: string;
  numDecks: number;
  potentialDecks: number;
  /** Fraction of decks playing this card, in [0, 1]. */
  inclusionRate: number;
  /** EDHREC synergy score, in [-1, 1]. */
  synergy: number;
}>;

export type EdhrecCommanderPage = Readonly<{
  slug: string;
  totalDecks: number;
  cards: readonly EdhrecCardEntry[];
}>;

/**
 * EDHREC URL slug for a commander's name (front face only for DFCs).
 * Examples:
 * - "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
 * - "K'rrik, Son of Yawgmoth" -> "krrik-son-of-yawgmoth"
 * - "Lim-Dûl the Necromancer" -> "lim-dul-the-necromancer"
 */
export function commanderSlug(name: string): string {
  const front = name.split(" // ")[0] ?? name;
  return front
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clampInclusionRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampSynergy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/**
 * Deduplicate card entries by normalized card name (case-insensitive), keeping the entry with
 * the highest `numDecks` (breaking ties by `synergy`).
 */
export function dedupeEdhrecEntries(entries: readonly EdhrecCardEntry[]): EdhrecCardEntry[] {
  const byName = new Map<string, EdhrecCardEntry>();
  for (const entry of entries) {
    const key = entry.cardName.trim().toLowerCase();
    if (key.length === 0) continue;
    const prev = byName.get(key);
    if (
      prev === undefined ||
      entry.numDecks > prev.numDecks ||
      (entry.numDecks === prev.numDecks && entry.synergy > prev.synergy)
    ) {
      byName.set(key, entry);
    }
  }
  return [...byName.values()];
}
