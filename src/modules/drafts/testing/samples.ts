import { PrintingId, SetCode, type Color, type Rarity } from "@/modules/catalog";
import { Cents, UserId } from "@/shared/kernel";
import type { DraftCardFacts } from "../domain/auto-pick";
import {
  DraftId,
  joinDraft,
  newDraft,
  type Draft,
  type OpenedPack,
  type PickTimer,
} from "../domain/draft";

// Sample drafts and cards for tests.

export const START = new Date("2026-10-02T18:00:00Z");
export const FEE = Cents.of(1647); // three packs at $5.49

/** A lobby hosted by the first player, with the others joined a second apart. */
export function sampleLobby(
  players: readonly string[],
  options: { timer?: PickTimer; maxSeats?: number } = {},
): Draft {
  const [host, ...others] = players;
  let draft: Draft = {
    ...newDraft({
      hostId: UserId.of(host),
      setCode: SetCode.of("TST"),
      boosterType: "play",
      maxSeats: options.maxSeats ?? 8,
      timer: options.timer ?? { kind: "on", secondsPerPick: 90 },
      entryFee: FEE,
      now: START,
    }),
    id: DraftId.of(1),
  };
  others.forEach((player, index) => {
    const joined = joinDraft(
      draft,
      UserId.of(player),
      new Date(START.getTime() + (index + 1) * 1000),
    );
    if (!joined.ok) throw new Error(`sample join failed: ${joined.error.kind}`);
    draft = joined.value;
  });
  return draft;
}

/**
 * Packs whose printings name their seat, round and slot ("s0r1c2"), so a test can see where a
 * card came from. `size` may be a number or a function giving each pack's size.
 */
export function samplePacks(
  seats: number,
  rounds: number,
  size: number | ((seat: number, round: number) => number) = 3,
): OpenedPack[][] {
  const sizeOf = typeof size === "number" ? () => size : size;
  return Array.from({ length: seats }, (_, seat) =>
    Array.from({ length: rounds }, (_, index) => ({
      seed: `seed-${seat}-${index + 1}`,
      cards: Array.from({ length: sizeOf(seat, index + 1) }, (_, slot) => ({
        printingId: PrintingId.of(`s${seat}r${index + 1}c${slot}`),
        finish: "nonfoil" as const,
      })),
    })),
  );
}

/** Facts for a made-up card. Mana cost defaults to one generic plus one pip per color. */
export function sampleCardFacts(
  overrides: Partial<DraftCardFacts> & { colors?: Color[]; rarity?: Rarity } = {},
): DraftCardFacts {
  const colors = overrides.colors ?? [];
  return {
    name: overrides.name ?? "Sample",
    rarity: overrides.rarity ?? "common",
    colors,
    manaCost: overrides.manaCost ?? `{1}${colors.map((color) => `{${color}}`).join("")}`,
    manaValue: overrides.manaValue ?? 1 + colors.length,
    typeLine: overrides.typeLine ?? "Creature — Sample",
    producedMana: overrides.producedMana ?? [],
    marketPrice: overrides.marketPrice ?? null,
  };
}

/** A printing id for domain tests (domain code may only import catalog types, not constructors). */
export function samplePrintingId(raw: string): PrintingId {
  return PrintingId.of(raw);
}
