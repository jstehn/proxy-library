import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { CardText } from "../domain/features/types";

// The text the recognizers read, one row per oracle card. A helper for the `cardFeatures` read and
// the features pass, so it is not listed in `queries/index.ts`.

type TextRow = {
  oracle_id: string;
  produced_mana: string[];
  keywords: string[];
  mana_value: number;
  faces: Array<{ name?: string; typeLine?: string; text?: string }>;
};

/**
 * One printing per oracle card: text never differs between printings of a card, except that a
 * reversible card repeats one card on both sides, so those come last (design doc 66, question 1).
 */
function oneTextPerCard(filter: SQL) {
  return sql`
    select distinct on (p.oracle_id) p.oracle_id, p.produced_mana, p.keywords, p.mana_value, p.faces
      from printings p
     where ${filter}
     order by p.oracle_id, (p.layout = 'reversible_card'), p.id`;
}

function toCardText(row: TextRow): CardText {
  return {
    oracleId: row.oracle_id,
    producedMana: row.produced_mana,
    keywords: row.keywords,
    manaValue: Number(row.mana_value),
    faces: (row.faces ?? []).map((face) => ({
      name: face.name ?? "",
      typeLine: face.typeLine ?? "",
      text: face.text ?? "",
    })),
  };
}

/** The text of these oracle cards. */
export async function cardTextsOf(
  db: DbExecutor,
  oracleIds: readonly string[],
): Promise<CardText[]> {
  if (oracleIds.length === 0) return [];
  const rows = await db.execute<TextRow>(
    oneTextPerCard(sql`p.oracle_id = any(${sql.param([...oracleIds])}::text[])`),
  );
  return rows.rows.map(toCardText);
}

/** Up to `limit` oracle cards with no stored features at `version` or newer, their text. */
export async function cardTextsToCompute(
  db: DbExecutor,
  version: number,
  limit: number,
): Promise<CardText[]> {
  const staleFilter = sql`not exists (
    select 1 from card_features f
     where f.oracle_id = p.oracle_id and f.features_version >= ${version}
  )`;
  const rows = await db.execute<TextRow>(sql`
    ${oneTextPerCard(staleFilter)}
    limit ${limit}`);
  return rows.rows.map(toCardText);
}
