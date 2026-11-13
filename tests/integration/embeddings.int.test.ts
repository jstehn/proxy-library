import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EMBEDDING_DIMS, EMBEDDING_MODEL, EMBEDDING_TEXT_VERSION } from "@/modules/catalog";
import { drizzleEmbeddingRepository } from "@/modules/catalog/infrastructure";
import {
  auditDeck,
  budgetReplacements,
  compareDeckSnapshot,
  deckCombosView,
  deckUpgradeRoadmap,
  embedSimForCards,
  makeDecks,
  optimizeDeckForView,
  semanticSearchForDeck,
  similarCards,
} from "@/modules/decks";
import { actor, clock, close, db, loadFixtureCatalog, resetPlayers, unitOfWork } from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

const decks = makeDecks({ unitOfWork, clock });
const jack = actor("jack");

function unitVec(axis: number, secondAxis?: number, secondWeight = 0): number[] {
  const vec = new Array<number>(EMBEDDING_DIMS).fill(0);
  vec[axis] = 1;
  if (secondAxis !== undefined && secondWeight !== 0) {
    vec[secondAxis] = secondWeight;
    const norm = Math.hypot(1, secondWeight);
    vec[axis] = 1 / norm;
    vec[secondAxis] = secondWeight / norm;
  }
  return vec;
}

describe("card embeddings & budget replacements", () => {
  it("stores embeddings in pgvector, computes embedSim, and finds budget replacements", async () => {
    const repo = drizzleEmbeddingRepository(db);
    const missing = await repo.listMissingOrStale(EMBEDDING_MODEL, EMBEDDING_TEXT_VERSION, 10);
    expect(missing.length).toBeGreaterThan(0);

    // Find 4 white/colorless fixture cards to give deterministic vectors + prices
    const cardRows = (
      await db.execute<{ id: string; oracle_id: string; name: string }>(sql`
        select distinct on (oracle_id) id, oracle_id, name
          from printings
         where name in ('Beza, the Bounding Spring', 'Banishing Light', 'Caretaker''s Talent', 'Fabled Passage')
         order by oracle_id, id
      `)
    ).rows;
    const byName = new Map(cardRows.map((r) => [r.name, r]));
    const beza = byName.get("Beza, the Bounding Spring");
    const banishing = byName.get("Banishing Light");
    const caretaker = byName.get("Caretaker's Talent");
    if (!beza || !banishing || !caretaker) {
      throw new Error("Expected fixture cards missing");
    }

    // Set Caretaker's Talent to $15.00 (1500¢) and Banishing Light to $1.00 (100¢)
    const today = new Date().toISOString().slice(0, 10);
    await db.execute(sql`
      insert into price_snapshots (printing_id, finish, day, usd_cents)
      values
        (${caretaker.id}, 'nonfoil', ${today}, 1500),
        (${banishing.id}, 'nonfoil', ${today}, 100)
      on conflict (printing_id, finish, day) do update set usd_cents = excluded.usd_cents
    `);

    const now = new Date();
    await repo.upsertBatch([
      {
        oracleId: beza.oracle_id,
        model: EMBEDDING_MODEL,
        textVersion: EMBEDDING_TEXT_VERSION,
        embedding: unitVec(0),
        updatedAt: now,
      },
      {
        oracleId: caretaker.oracle_id,
        model: EMBEDDING_MODEL,
        textVersion: EMBEDDING_TEXT_VERSION,
        embedding: unitVec(0, 1, 0.2),
        updatedAt: now,
      },
      {
        oracleId: banishing.oracle_id,
        model: EMBEDDING_MODEL,
        textVersion: EMBEDDING_TEXT_VERSION,
        embedding: unitVec(0, 1, 0.25),
        updatedAt: now,
      },
    ]);

    // 1. embedSimForCards returns positive cosine similarity between Banishing Light and Beza/Caretaker
    const sims = await embedSimForCards(
      db,
      [beza.oracle_id, caretaker.oracle_id],
      [banishing.oracle_id],
    );
    expect(sims.get(banishing.oracle_id)).toBeGreaterThan(0.9);

    // 2. Create a deck with Beza + Caretaker's Talent
    const created = await decks.createDeck(jack, { name: "Budget Test", format: "commander" });
    if (!created.ok) throw new Error(created.error.kind);
    await decks.importList(jack, {
      deckId: created.value,
      text: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Caretaker's Talent\n30 Plains",
    });

    // 3. similarCards uses vector similarity when embeddings exist
    const simResult = await similarCards(db, jack.userId, created.value, caretaker.oracle_id);
    expect(simResult).not.toBeNull();
    expect(simResult?.store.some((s) => s.card.oracleId === banishing.oracle_id)).toBe(true);

    // 4. budgetReplacements finds Banishing Light ($1) as a cheaper replacement for Caretaker's Talent ($15)
    const replacements = await budgetReplacements(db, jack.userId, created.value, {
      minPriceCents: 500,
      maxPriceCents: 200,
    });
    expect(replacements).not.toBeNull();
    const caretakerEntry = replacements?.cards.find(
      (c) => c.target.oracleId === caretaker.oracle_id,
    );
    expect(caretakerEntry).toBeDefined();
    const pick = caretakerEntry?.store.find((p) => p.card.oracleId === banishing.oracle_id);
    expect(pick).toBeDefined();
    expect(pick?.savedCents).toBe(
      (caretakerEntry?.target.priceCents ?? 0) - (pick?.card.priceCents ?? 0),
    );
    expect(pick?.savedCents).toBeGreaterThan(0);
    expect(pick?.similarityPct).toBeGreaterThan(90);

    // 5. semanticSearchForDeck finds Banishing Light via injected embedder + optional RRF filter
    const fakeEmbedder = async () => [unitVec(0, 1, 0.25)];
    const semantic = await semanticSearchForDeck(db, fakeEmbedder, jack.userId, created.value, {
      concept: "exile target nonland permanent until it leaves",
      filter: "Banishing",
      types: ["enchantment"],
      maxPriceCents: 200,
    });
    expect(semantic).not.toBeNull();
    expect(semantic?.store.some((s) => s.card.oracleId === banishing.oracle_id)).toBe(true);

    const excludedByType = await semanticSearchForDeck(
      db,
      fakeEmbedder,
      jack.userId,
      created.value,
      {
        concept: "exile target nonland permanent until it leaves",
        excludeTypes: ["enchantment"],
        maxPriceCents: 200,
      },
    );
    expect(excludedByType?.store.some((s) => s.card.oracleId === banishing.oracle_id)).toBe(false);

    // 6. deckCombosView returns complete & 1-card-away combos from spellbook_two_card_combos
    await db.execute(sql`
      insert into spellbook_two_card_combos (id, oracle_id_a, oracle_id_b, card_name_a, card_name_b, produces, forces_bracket, synced_at)
      values ('test-combo-1', ${caretaker.oracle_id}, ${banishing.oracle_id}, ${"Caretaker's Talent"}, ${"Banishing Light"}, '["Infinite value"]'::jsonb, 3, now())
      on conflict (id) do nothing
    `);
    const combos = await deckCombosView(db, jack.userId, created.value);
    expect(combos).not.toBeNull();
    expect(
      combos?.oneCardAway.store.some((entry) => entry.card.oracleId === banishing.oracle_id),
    ).toBe(true);

    // 7. optimizeDeckForView runs Simulated Annealing without mutating the deck
    const optimized = await optimizeDeckForView(db, jack.userId, created.value, {
      pool: "store",
      maxSwaps: 2,
      iterations: 60,
      seed: "int-opt-1",
    });
    expect(optimized).not.toBeNull();
    expect(optimized?.result.iterationsRun).toBeGreaterThanOrEqual(0);
    expect(optimized?.result.after.total).toBeGreaterThanOrEqual(
      optimized?.result.before.total ?? 0,
    );
    expect(optimized?.result.swaps.length).toBeLessThanOrEqual(2);

    // 8. auditDeck returns a one-shot health report
    const audit = await auditDeck(db, jack.userId, created.value);
    expect(audit).not.toBeNull();
    expect(audit?.deck.id).toBe(created.value);
    expect(audit?.score.total).toBeTypeOf("number");
    expect(audit?.roles.length).toBeGreaterThan(0);
    expect(audit?.findings.length).toBeGreaterThan(0);

    // 9. deckUpgradeRoadmap and compareDeckSnapshot (with scoreDelta)
    const roadmap = await deckUpgradeRoadmap(db, jack.userId, created.value);
    expect(roadmap).not.toBeNull();
    expect(roadmap?.roadmap.tiers).toHaveLength(3);

    const snap = await decks.saveSnapshot(jack, { deckId: created.value, label: "Before diff" });
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      const diff = await compareDeckSnapshot(db, jack.userId, created.value, snap.value);
      expect(diff).not.toBeNull();
      expect(diff?.scoreDelta).toBe(0);
      expect(diff?.scoreBefore.total).toBe(diff?.scoreAfter.total);
    }
  });
});
