import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "@/shared/kernel";
import type { SpellbookTwoCardCombo } from "../domain/spellbook";
import type {
  CatalogDependencies,
  CatalogServices,
  SpellbookGateway,
  SpellbookRepository,
} from "./ports";
import { makeSpellbookSync } from "./spellbook";

describe("makeSpellbookSync", () => {
  const sampleCombo: SpellbookTwoCardCombo = {
    id: "1",
    oracleIdA: "a",
    oracleIdB: "b",
    cardNameA: "Demonic Consultation",
    cardNameB: "Thassa's Oracle",
    produces: ["Win the game"],
    bracketTag: "R",
    manaValue: 3,
    forcesBracket: 4,
  };

  function setup(lastSynced: Date | null, gateway: SpellbookGateway) {
    let saved: readonly SpellbookTwoCardCombo[] = [];
    const repo: SpellbookRepository = {
      async lastSyncedAt() {
        return lastSynced;
      },
      async replaceTwoCardCombos(combos) {
        saved = combos;
      },
    };
    const unitOfWork: UnitOfWork<CatalogServices> = {
      async run(fn) {
        return fn({
          catalog: {} as CatalogServices["catalog"],
          syncRuns: {} as CatalogServices["syncRuns"],
          artwork: {} as CatalogServices["artwork"],
          spellbook: repo,
        }) as never;
      },
    };
    const deps = {
      unitOfWork,
      spellbook: gateway,
      clock: { now: () => new Date("2026-11-13T00:00:00Z") },
    } as unknown as CatalogDependencies;

    return { sync: makeSpellbookSync(deps), getSaved: () => saved };
  }

  it("skips when synced within the last 7 days unless forced", async () => {
    let called = 0;
    const { sync, getSaved } = setup(new Date("2026-11-10T00:00:00Z"), {
      async fetchTwoCardCombos() {
        called += 1;
        return [sampleCombo];
      },
    });
    expect(await sync.syncSpellbookCombos()).toEqual({ synced: 0, skipped: true, failed: false });
    expect(called).toBe(0);

    expect(await sync.syncSpellbookCombos({ force: true })).toEqual({
      synced: 1,
      skipped: false,
      failed: false,
    });
    expect(called).toBe(1);
    expect(getSaved()).toEqual([sampleCombo]);
  });

  it("syncs when no previous sync exists", async () => {
    const { sync, getSaved } = setup(null, {
      async fetchTwoCardCombos() {
        return [sampleCombo];
      },
    });
    expect(await sync.syncSpellbookCombos()).toEqual({ synced: 1, skipped: false, failed: false });
    expect(getSaved()).toEqual([sampleCombo]);
  });
});
