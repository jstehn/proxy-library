import { and, inArray, lte, notInArray, or } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { spellbookTwoCardCombos } from "@/modules/catalog/infrastructure/schema";
import type { Bracket, DeckCombo } from "../domain/brackets";

/**
 * Finds Commander Spellbook two-card combos present in a deck's played cards.
 * Returns `undefined` when the combo table hasn't been synced yet so `estimateBracket`
 * keeps `"combos"` in `unchecked` rather than falsely claiming 0 combos.
 */
export async function combosForDeck(
  db: DbExecutor,
  playedOracleIds: readonly string[],
): Promise<readonly DeckCombo[] | undefined> {
  const [anyRow] = await db
    .select({ id: spellbookTwoCardCombos.id })
    .from(spellbookTwoCardCombos)
    .limit(1);
  if (!anyRow) return undefined;

  const unique = Array.from(new Set(playedOracleIds));
  if (unique.length < 2) return [];

  const rows = await db
    .select({
      id: spellbookTwoCardCombos.id,
      cardNameA: spellbookTwoCardCombos.cardNameA,
      cardNameB: spellbookTwoCardCombos.cardNameB,
      produces: spellbookTwoCardCombos.produces,
      forcesBracket: spellbookTwoCardCombos.forcesBracket,
    })
    .from(spellbookTwoCardCombos)
    .where(
      and(
        inArray(spellbookTwoCardCombos.oracleIdA, unique),
        inArray(spellbookTwoCardCombos.oracleIdB, unique),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    cards: [row.cardNameA, row.cardNameB] as const,
    produces: row.produces,
    forces: (row.forcesBracket >= 4 ? 4 : 3) as Bracket,
  }));
}

/**
 * Finds cards not yet in the deck that form a Commander Spellbook two-card combo with a card
 * already in the deck, filtered to respect `targetBracket` (Brackets 1–2 allow none).
 * Returns `Map<candidateOracleId, partnerCardNames[]>`.
 */
export async function comboPartnersForDeck(
  db: DbExecutor,
  playedOracleIds: readonly string[],
  targetBracket: Bracket | null,
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (targetBracket !== null && targetBracket <= 2) return new Map();
  const unique = Array.from(new Set(playedOracleIds));
  if (unique.length === 0) return new Map();

  const bracketFilter =
    targetBracket !== null ? lte(spellbookTwoCardCombos.forcesBracket, targetBracket) : undefined;

  const rows = await db
    .select({
      oracleIdA: spellbookTwoCardCombos.oracleIdA,
      oracleIdB: spellbookTwoCardCombos.oracleIdB,
      cardNameA: spellbookTwoCardCombos.cardNameA,
      cardNameB: spellbookTwoCardCombos.cardNameB,
    })
    .from(spellbookTwoCardCombos)
    .where(
      and(
        bracketFilter,
        or(
          and(
            inArray(spellbookTwoCardCombos.oracleIdA, unique),
            notInArray(spellbookTwoCardCombos.oracleIdB, unique),
          ),
          and(
            inArray(spellbookTwoCardCombos.oracleIdB, unique),
            notInArray(spellbookTwoCardCombos.oracleIdA, unique),
          ),
        ),
      ),
    );

  const inDeck = new Set(unique);
  const partners = new Map<string, string[]>();
  for (const row of rows) {
    const [candidateId, partnerName] = inDeck.has(row.oracleIdA)
      ? [row.oracleIdB, row.cardNameA]
      : [row.oracleIdA, row.cardNameB];
    const list = partners.get(candidateId) ?? [];
    if (!list.includes(partnerName)) list.push(partnerName);
    partners.set(candidateId, list);
  }
  return partners;
}
