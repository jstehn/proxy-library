import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import type { CardEmbeddingRow, CardTextToEmbed, EmbeddingRepository } from "../application/ports";
import { cardEmbeddings } from "./schema";

type MissingRow = {
  oracle_id: string;
  name: string;
  type_line: string;
  faces: Array<{ text?: string }>;
};

export function drizzleEmbeddingRepository(db: DbExecutor): EmbeddingRepository {
  return {
    async listMissingOrStale(
      model: string,
      textVersion: number,
      limit?: number,
    ): Promise<CardTextToEmbed[]> {
      const limitClause = limit !== undefined ? sql`limit ${limit}` : sql``;
      const rows = (
        await db.execute<MissingRow>(sql`
          select p.oracle_id, p.name, p.type_line, p.faces
            from (
              select distinct on (oracle_id) oracle_id, name, type_line, faces
                from printings
               order by oracle_id, id
            ) p
            left join card_embeddings e on e.oracle_id = p.oracle_id
           where e.oracle_id is null
              or e.model <> ${model}
              or e.text_version <> ${textVersion}
           order by p.oracle_id
           ${limitClause}
        `)
      ).rows;

      return rows.map((row) => ({
        oracleId: row.oracle_id,
        name: row.name,
        typeLine: row.type_line,
        text: (row.faces ?? [])
          .map((face) => face.text ?? "")
          .filter(Boolean)
          .join("\n//\n"),
      }));
    },

    async upsertBatch(rows: readonly CardEmbeddingRow[]): Promise<void> {
      if (rows.length === 0) return;
      await db
        .insert(cardEmbeddings)
        .values(
          rows.map((row) => ({
            oracleId: row.oracleId,
            model: row.model,
            textVersion: row.textVersion,
            embedding: row.embedding,
            updatedAt: row.updatedAt,
          })),
        )
        .onConflictDoUpdate({
          target: cardEmbeddings.oracleId,
          set: {
            model: sql`excluded.model`,
            textVersion: sql`excluded.text_version`,
            embedding: sql`excluded.embedding`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    },
  };
}
