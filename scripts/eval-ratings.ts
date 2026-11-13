import pg from "pg";
import type { Tag, Theme } from "@/shared/card-search";
import { estimateBracket, bracketLine, type Bracket } from "@/modules/decks/domain/brackets";
import { evaluateHoldout, type EvalDeckLine } from "@/modules/decks/domain/eval";
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
import { isLand } from "@/modules/decks/domain/stats";
import { deckProfile, type CandidateCard } from "@/modules/decks/domain/suggest";

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
         keywords, produced_mana, role_tags, theme_tags, is_game_changer, edhrec_rank, faces
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

    const calibrate = process.argv.includes("--calibrate");
    const totals = new Map<string, { recall: number; mrr: number; count: number }>();
    const embedTotals = new Map<string, { recall: number; mrr: number; count: number }>();
    const samplesByTier = new Map<PowerTier, CalibrationSample[]>();
    const deckContexts: Array<{
      lines: EvalDeckLine[];
      distractors: CandidateCard[];
      embedSimByOracleId: Map<string, number>;
    }> = [];
    for (const t of tiers) {
      totals.set(t.label, { recall: 0, mrr: 0, count: 0 });
      embedTotals.set(t.label, { recall: 0, mrr: 0, count: 0 });
      samplesByTier.set(powerTierForBracket(t.bracket), []);
    }

    for (const deck of deckRows) {
      const ids = [...new Set(deck.cards.map((c) => c.printingId))];
      const { rows: cardRows } = await pool.query<PrintingRow>(
        `SELECT id, oracle_id, name, type_line, mana_value, rarity,
                keywords, produced_mana, role_tags, theme_tags, is_game_changer, edhrec_rank, faces
         FROM printings
         WHERE id = ANY($1::text[])`,
        [ids],
      );
      const byId = new Map(cardRows.map((r) => [r.id, r]));
      const lines: EvalDeckLine[] = [];
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

      const bracketEst = estimateBracket(
        "commander",
        lines.map((l) =>
          bracketLine({
            name: l.name,
            quantity: l.quantity,
            board: l.board,
            typeLine: l.typeLine,
            text: l.text ?? "",
            isGameChanger: l.candidate.isGameChanger ?? false,
          }),
        ),
      );
      void bracketEst;

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
        const res = evaluateHoldout(lines, deckDistractors, {
          format: "commander",
          holdoutCount: 10,
          k: 50,
          targetBracket: t.bracket,
        });
        const acc = totals.get(t.label)!;
        acc.recall += res.recallAtK;
        acc.mrr += res.mrr;
        acc.count += 1;

        const resEmbed = evaluateHoldout(lines, deckDistractors, {
          format: "commander",
          holdoutCount: 10,
          k: 50,
          targetBracket: t.bracket,
          embedSimByOracleId,
        });
        const accE = embedTotals.get(t.label)!;
        accE.recall += resEmbed.recallAtK;
        accE.mrr += resEmbed.mrr;
        accE.count += 1;

        if (calibrate) {
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
      if (calibrate) {
        deckContexts.push({ lines, distractors: deckDistractors, embedSimByOracleId });
      }
    }

    console.log(
      `Evaluated ${totals.get("upgraded (B3/baseline)")?.count ?? 0} Commander precons (holdout=10, distractors<=300, k=50):`,
    );
    for (const t of tiers) {
      const acc = totals.get(t.label)!;
      const accE = embedTotals.get(t.label)!;
      const n = Math.max(1, acc.count);
      console.log(
        `  ${t.label.padEnd(24)} Baseline: Recall@50 = ${((acc.recall / n) * 100).toFixed(1)}%  MRR = ${(acc.mrr / n).toFixed(3)}   | +Embeddings: Recall@50 = ${((accE.recall / n) * 100).toFixed(1)}%  MRR = ${(accE.mrr / n).toFixed(3)}`,
      );
    }

    if (calibrate) {
      console.log("\nFitting logistic weights per PowerTier...");
      const fittedByTier: Record<PowerTier, RatingWeights> = {
        casual: fitLogisticWeights(samplesByTier.get("casual")!, weightsForBracket(2)),
        upgraded: fitLogisticWeights(samplesByTier.get("upgraded")!, weightsForBracket(3)),
        optimized: fitLogisticWeights(samplesByTier.get("optimized")!, weightsForBracket(4)),
      };
      for (const t of tiers) {
        const tier = powerTierForBracket(t.bracket);
        const fitted = fittedByTier[tier];
        let recall = 0;
        let mrr = 0;
        for (const ctx of deckContexts) {
          const res = evaluateHoldout(ctx.lines, ctx.distractors, {
            format: "commander",
            holdoutCount: 10,
            k: 50,
            targetBracket: t.bracket,
            embedSimByOracleId: ctx.embedSimByOracleId,
            weightsOverride: fitted,
          });
          recall += res.recallAtK;
          mrr += res.mrr;
        }
        const n = Math.max(1, deckContexts.length);
        console.log(
          `  ${t.label.padEnd(24)} Calibrated: Recall@50 = ${((recall / n) * 100).toFixed(1)}%  MRR = ${(mrr / n).toFixed(3)}`,
        );
      }
      console.log("\nFitted RATING_WEIGHTS_BY_TIER:");
      console.log(JSON.stringify(fittedByTier, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
