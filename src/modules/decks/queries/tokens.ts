import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import {
  deckTokens,
  newestFirst,
  type TokenArt,
  type TokenChoice,
  type TokenLine,
  type TokenLinkRow,
  type TokenMaker,
} from "../domain/token-proxies";

// The tokens a deck's cards make, for the print page and the PDF (design doc 25, section 9).

type TokenArtRow = {
  id: string;
  oracle_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  colors: string[];
  faces: TokenArt["faces"];
  artist: string | null;
  released_at: string;
  has_back: boolean;
};

/** The columns of a TokenArtRow, from token_printings "t". */
const TOKEN_ART_COLUMNS: SQL = sql`
  t.id, t.oracle_id, t.name, t.set_code, t.collector_number, t.colors, t.faces, t.artist,
  t.released_at,
  -- Token sets are listed in card_sets in capitals ("TBLB"); some aren't listed at all.
  coalesce((select s.name from card_sets s where s.code = upper(t.set_code)), upper(t.set_code))
    as set_name,
  coalesce(t.image_uris -> 'back', 'null'::jsonb) <> 'null'::jsonb as has_back`;

function toTokenArt(row: TokenArtRow): TokenArt {
  return {
    id: row.id,
    oracleId: row.oracle_id,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    colors: row.colors,
    // Written by the catalog's sync as CardFace[], the shape a PrintedFace has.
    faces: row.faces,
    artist: row.artist,
    releasedAt: row.released_at,
    hasBack: row.has_back,
  };
}

/**
 * The tokens `makers` (a deck's cards, in deck order) make, with this deck's choices applied.
 * Every printing of each card counts, so a card makes its tokens whichever printing you have.
 */
export async function deckTokenLines(
  db: DbExecutor,
  deckId: number,
  makers: readonly TokenMaker[],
): Promise<TokenLine[]> {
  const cardOracleIds = [...new Set(makers.map((maker) => maker.oracleId))];
  if (cardOracleIds.length === 0) return [];
  const [links, choices] = await Promise.all([
    db.execute<TokenArtRow & { card_oracle_id: string; printing_id: string }>(sql`
      select p.oracle_id as card_oracle_id, pt.printing_id, ${TOKEN_ART_COLUMNS}
        from printing_tokens pt
        join printings p on p.id = pt.printing_id
        join token_printings t on t.id = pt.token_id
       where p.oracle_id = any(${sql.param(cardOracleIds)}::text[])
    `),
    db.execute<{ token_oracle_id: string; token_id: string | null; included: boolean }>(sql`
      select token_oracle_id, token_id, included from deck_token_choices where deck_id = ${deckId}
    `),
  ]);
  const chosenIds = choices.rows.flatMap((row) => (row.token_id === null ? [] : [row.token_id]));
  const chosen = await tokenArtsByIds(db, chosenIds);
  return deckTokens(
    makers,
    links.rows.map((row): TokenLinkRow => ({
      cardOracleId: row.card_oracle_id,
      printingId: row.printing_id,
      token: toTokenArt(row),
    })),
    choices.rows.map((row): TokenChoice => ({
      tokenOracleId: row.token_oracle_id,
      tokenId: row.token_id,
      included: row.included,
    })),
    chosen,
  );
}

async function tokenArtsByIds(
  db: DbExecutor,
  ids: readonly string[],
): Promise<Map<string, TokenArt>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<TokenArtRow>(sql`
    select ${TOKEN_ART_COLUMNS} from token_printings t where t.id = any(${sql.param([...ids])}::text[])
  `);
  return new Map(rows.rows.map((row) => [row.id, toTokenArt(row)]));
}

/** Every art of one token, newest first, for the art picker. */
export async function tokenArtOptions(db: DbExecutor, tokenOracleId: string): Promise<TokenArt[]> {
  const rows = await db.execute<TokenArtRow>(sql`
    select ${TOKEN_ART_COLUMNS} from token_printings t where t.oracle_id = ${tokenOracleId}
  `);
  return newestFirst(rows.rows.map(toTokenArt));
}
