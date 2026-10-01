import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { parseList } from "@/shared/card-search";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import {
  nameKey,
  quoteList,
  type Candidate,
  type ListQuote,
  type QuoteOptions,
} from "../domain/shopping-list";

// The quote for a pasted list of singles (design doc 15, section 3): read only, nothing saved.
// One query each for the printings for sale, the names the catalog knows, and what the player
// owns; the domain decides the rest.

const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

/** `array['a', 'b']::text[]` with every value as a parameter. */
function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/** Matches a printing "p" by its whole name or its front face's ("Delver of Secrets"). */
function nameIn(names: SQL): SQL {
  return sql`(lower(p.name) = any(${names}) or lower(split_part(p.name, ' // ', 1)) = any(${names}))`;
}

/** What the list would buy right now, at today's prices. */
export async function quoteShoppingList(
  db: DbExecutor,
  userId: UserId,
  text: string,
  options: QuoteOptions,
): Promise<ListQuote> {
  const parsed = parseList(text);
  const names = [...new Set(parsed.lines.map((line) => nameKey(line.name)))];
  if (names.length === 0) return quoteList([], parsed.unreadable, emptyAnswers(), options);
  const wanted = textArray(names);

  const [forSaleRows, knownRows] = await Promise.all([
    db.execute<{
      printing_id: string;
      oracle_id: string;
      name: string;
      set_code: string;
      set_name: string;
      collector_number: string;
      variant_label: string;
      release_date: string;
      finish: string;
      usd_cents: number;
    }>(sql`
      select p.id as printing_id, p.oracle_id, p.name, p.set_code, s.name as set_name,
             p.collector_number, p.variant_label, s.release_date, latest.finish, latest.usd_cents
        from printings p
        join card_sets s on s.code = p.set_code and s.is_enabled
        -- The newest price of each finish: what buying it would cost (as the store's quote).
        join lateral (select distinct on (ps.finish) ps.finish, ps.usd_cents
                        from price_snapshots ps where ps.printing_id = p.id
                       order by ps.finish, ps.day desc) latest on true
       where ${nameIn(wanted)}
    `),
    db.execute<{ name: string; oracle_id: string }>(sql`
      select distinct p.name, p.oracle_id from printings p where ${nameIn(wanted)}
    `),
  ]);

  const oracleIds = [...new Set(knownRows.rows.map((row) => row.oracle_id))];
  const ownedRows =
    oracleIds.length === 0
      ? { rows: [] }
      : await db.execute<{ oracle_id: string; owned: number }>(sql`
          select p.oracle_id, sum(c.quantity)::int as owned
            from collection_cards c join printings p on p.id = c.printing_id
           where c.user_id = ${userId} and p.oracle_id = any(${textArray(oracleIds)})
           group by p.oracle_id
        `);

  // Each printing is findable by its whole name and by its front face's name.
  const keysOf = (name: string) => [...new Set([nameKey(name), nameKey(name.split(" // ")[0])])];
  const forSale = new Map<string, Candidate[]>();
  for (const row of forSaleRows.rows) {
    const candidate: Candidate = {
      printingId: row.printing_id,
      oracleId: row.oracle_id,
      name: row.name,
      setCode: row.set_code,
      setName: row.set_name,
      collectorNumber: row.collector_number,
      variantLabel: row.variant_label,
      releaseDate: row.release_date,
      finish: FinishSchema.parse(row.finish),
      priceCents: Number(row.usd_cents),
    };
    for (const key of keysOf(row.name)) forSale.set(key, [...(forSale.get(key) ?? []), candidate]);
  }
  return quoteList(
    parsed.lines,
    parsed.unreadable,
    {
      forSale,
      known: new Set(knownRows.rows.flatMap((row) => keysOf(row.name))),
      owned: new Map(ownedRows.rows.map((row) => [row.oracle_id, row.owned])),
    },
    options,
  );
}

function emptyAnswers() {
  return { forSale: new Map(), known: new Set<string>(), owned: new Map<string, number>() };
}
