import pg from "pg";
import { type Tag, type Theme } from "@/shared/kernel";
import type { Bracket } from "@/modules/decks/domain/brackets";
import {
  emptyRatingProfile,
  fitLogisticWeights,
  powerTierForBracket,
  ratingFeatureVector,
  weightsForBracket,
  type CalibrationSample,
  type PowerTier,
  type RatingWeights,
} from "@/modules/decks/domain/rate";
import { isLand, type ProfileLine } from "@/modules/decks/domain/stats";
import { deckProfile, type CandidateCard } from "@/modules/decks/domain/suggest";

// Fits the rating weights per power tier (logistic regression) against held-out cards of the
// Commander precons, and prints the result to paste into `RATING_WEIGHTS_BY_TIER` (rate.ts).

type DeckLine = ProfileLine &
  Readonly<{
    oracleId: string;
    name: string;
    candidate: CandidateCard;
  }>;

type DeckCardJson = {
  printingId: string;
  count: number;
  board?: "main" | "commander" | "side";
};

type PrintingRow = {
  id: string;
  oracle_id: string;
  name: string;
  type_line: string;
  mana_value: number;
  rarity: string;
  keywords: string[];
  produced_mana: string[];
  role_tags: string[];
  theme_tags: string[];
  is_game_changer: boolean;
  edhrec_rank: number | null;
  faces: Array<{ text?: string }>;
};

function toCandidate(row: PrintingRow): CandidateCard {
  const text = (row.faces ?? [])
    .map((f) => f.text ?? "")
    .filter(Boolean)
    .join("\n//\n");
  return {
    oracleId: row.oracle_id,
    name: row.name,
    typeLine: row.type_line,
    manaValue: row.mana_value,
    text,
    keywords: row.keywords ?? [],
    roles: (row.role_tags ?? []) as Tag[],
    themes: (row.theme_tags ?? []) as Theme[],
    rarity: row.rarity,
    priceCents: null,
    pool: "store",
    edhrecRank: row.edhrec_rank,
    isGameChanger: row.is_game_changer,
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url });

  try {
    const { rows: deckRows } = await pool.query<{
      set_code: string;
      name: string;
      cards: DeckCardJson[];
    }>(
      `SELECT set_code, name, cards
       FROM deck_lists
       WHERE type ILIKE '%commander%' AND jsonb_array_length(cards) >= 90
       ORDER BY set_code, name
       LIMIT 30`,
    );

    const { rows: distractorRows } = await pool.query<PrintingRow>(
      `SELECT DISTINCT ON (oracle_id)
         id, oracle_id, name, type_line, mana_value, rarity,
         keywords, produced_mana, coalesce((select role_tags from card_features f where f.oracle_id = printings.oracle_id), '{}') AS role_tags,
         coalesce((select theme_tags from card_features f where f.oracle_id = printings.oracle_id), '{}') AS theme_tags,
         is_game_changer, edhrec_rank, faces
       FROM printings
       WHERE type_line NOT ILIKE '%Land%'
       ORDER BY oracle_id, id
       LIMIT 300`,
    );
    const distractors = distractorRows.map(toCandidate);

    const tiers: Array<{ label: string; bracket: Bracket | null }> = [
      { label: "casual (B2)", bracket: 2 },
      { label: "upgraded (B3/baseline)", bracket: 3 },
      { label: "optimized (B4)", bracket: 4 },
    ];

    const samplesByTier = new Map<PowerTier, CalibrationSample[]>();
    for (const t of tiers) {
      samplesByTier.set(powerTierForBracket(t.bracket), []);
    }

    for (const deck of deckRows) {
      const ids = [...new Set(deck.cards.map((c) => c.printingId))];
      const { rows: cardRows } = await pool.query<PrintingRow>(
        `SELECT id, oracle_id, name, type_line, mana_value, rarity,
                keywords, produced_mana, coalesce((select role_tags from card_features f where f.oracle_id = printings.oracle_id), '{}') AS role_tags,
                coalesce((select theme_tags from card_features f where f.oracle_id = printings.oracle_id), '{}') AS theme_tags,
                is_game_changer, edhrec_rank, faces
         FROM printings
         WHERE id = ANY($1::text[])`,
        [ids],
      );
      const byId = new Map(cardRows.map((r) => [r.id, r]));
      const lines: DeckLine[] = [];
      for (const entry of deck.cards) {
        const row = byId.get(entry.printingId);
        if (!row) continue;
        const candidate = toCandidate(row);
        lines.push({
          oracleId: row.oracle_id,
          name: row.name,
          board: entry.board ?? "main",
          quantity: entry.count,
          typeLine: row.type_line,
          manaValue: row.mana_value,
          text: candidate.text,
          keywords: candidate.keywords,
          producedMana: row.produced_mana ?? [],
          priceCents: null,
          candidate,
        });
      }
      if (lines.length < 50) continue;

      const deckOracleIds = new Set(lines.map((l) => l.oracleId));
      const deckDistractors = distractors.filter((d) => !deckOracleIds.has(d.oracleId));

      const deckSpellIds = lines
        .filter((l) => !isLand(l.typeLine) || l.board === "commander")
        .map((l) => l.oracleId);
      const poolOracleIds = [
        ...new Set([...lines.map((l) => l.oracleId), ...deckDistractors.map((d) => d.oracleId)]),
      ];
      const { rows: simRows } = await pool.query<{ oracle_id: string; embed_sim: number }>(
        `SELECT c.oracle_id, avg(s.sim)::float8 AS embed_sim
           FROM card_embeddings c
           JOIN LATERAL (
             SELECT 1 - (c.embedding <=> d.embedding) AS sim
               FROM card_embeddings d
              WHERE d.oracle_id = ANY($1::text[])
                AND d.oracle_id <> c.oracle_id
              ORDER BY c.embedding <=> d.embedding
              LIMIT 5
           ) s ON true
          WHERE c.oracle_id = ANY($2::text[])
          GROUP BY c.oracle_id`,
        [deckSpellIds, poolOracleIds],
      );
      const embedSimByOracleId = new Map(simRows.map((r) => [r.oracle_id, Number(r.embed_sim)]));

      for (const t of tiers) {
        const eligible = lines.filter((l) => l.board === "main" && !isLand(l.typeLine));
        const step = Math.max(1, Math.floor(eligible.length / 10));
        const heldOutIds = new Set<string>();
        for (let i = 0; i < eligible.length && heldOutIds.size < 10; i += step) {
          heldOutIds.add(eligible[i].oracleId);
        }
        const remaining = lines.filter((l) => !heldOutIds.has(l.oracleId));
        const profile = deckProfile(remaining, "commander");
        const ratingProf = {
          ...emptyRatingProfile("commander"),
          ...profile,
        };
        const bucket = samplesByTier.get(powerTierForBracket(t.bracket))!;
        for (const card of eligible) {
          if (!heldOutIds.has(card.oracleId)) continue;
          const sim = embedSimByOracleId.get(card.oracleId);
          bucket.push({
            features: ratingFeatureVector(
              sim !== undefined ? { ...card.candidate, embedSim: sim } : card.candidate,
              ratingProf,
              { targetBracket: t.bracket },
            ),
            label: 1,
          });
        }
        for (const d of deckDistractors.slice(0, 60)) {
          const sim = embedSimByOracleId.get(d.oracleId);
          bucket.push({
            features: ratingFeatureVector(
              sim !== undefined ? { ...d, embedSim: sim } : d,
              ratingProf,
              { targetBracket: t.bracket },
            ),
            label: 0,
          });
        }
      }
    }

    console.log("Fitting logistic weights per PowerTier...");
    const fittedByTier: Record<PowerTier, RatingWeights> = {
      casual: fitLogisticWeights(samplesByTier.get("casual")!, weightsForBracket(2)),
      upgraded: fitLogisticWeights(samplesByTier.get("upgraded")!, weightsForBracket(3)),
      optimized: fitLogisticWeights(samplesByTier.get("optimized")!, weightsForBracket(4)),
    };
    console.log("Fitted RATING_WEIGHTS_BY_TIER:");
    console.log(JSON.stringify(fittedByTier, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
