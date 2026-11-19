import type { Actor } from "@/modules/accounts";
import { err, ok, type Clock, type Result, type UserId } from "@/shared/kernel";
import type { DeckPlan } from "../domain/deck-profile";
import type { DeckSource, StoredDeckProfile } from "../domain/deck-view";
import type { DeckNotFound } from "../domain/errors";

// The parts of a deck that aren't cards: its profile (plan, key cards, avoid cards), its primer
// and the research sources saved on it. The deck builder's plan panel and the update_deck tool
// both save through here.

export type DeckPlanWriters = Readonly<{
  clock: Clock;
  updateProfile(
    userId: UserId,
    deckId: number,
    patch: Partial<DeckPlan>,
    now: Date,
  ): Promise<StoredDeckProfile | null>;
  updatePrimer(
    userId: UserId,
    deckId: number,
    input: Readonly<{ section?: string; content: string }>,
    now: Date,
  ): Promise<Readonly<{ deckId: number; primer: string }> | null>;
  addSource(
    userId: UserId,
    deckId: number,
    source: Readonly<{ url: string; title: string; usedFor: string }>,
    now: Date,
  ): Promise<DeckSource[] | null>;
}>;

export type SavedSource = Readonly<{ source: DeckSource | null; totalCount: number }>;

export function makeDeckPlanEdits(writers: DeckPlanWriters) {
  const { clock } = writers;

  /** Changes the fields of the profile that the patch names; the others stay. */
  async function setProfile(
    actor: Actor,
    input: Readonly<{ deckId: number; patch: Partial<DeckPlan> }>,
  ): Promise<Result<StoredDeckProfile, DeckNotFound>> {
    const stored = await writers.updateProfile(
      actor.userId,
      input.deckId,
      input.patch,
      clock.now(),
    );
    return stored === null ? err({ kind: "DeckNotFound" }) : ok(stored);
  }

  /** Replaces the primer, or one `## Section` of it; "" removes the section (or clears it). */
  async function setPrimer(
    actor: Actor,
    input: Readonly<{ deckId: number; section?: string; content: string }>,
  ): Promise<Result<Readonly<{ deckId: number; primer: string }>, DeckNotFound>> {
    const stored = await writers.updatePrimer(
      actor.userId,
      input.deckId,
      { section: input.section, content: input.content },
      clock.now(),
    );
    return stored === null ? err({ kind: "DeckNotFound" }) : ok(stored);
  }

  /** Saves a research link on the deck and says which source it is among all of them. */
  async function saveSource(
    actor: Actor,
    input: Readonly<{ deckId: number; url: string; title?: string; usedFor?: string }>,
  ): Promise<Result<SavedSource, DeckNotFound>> {
    const sources = await writers.addSource(
      actor.userId,
      input.deckId,
      { url: input.url, title: input.title ?? input.url, usedFor: input.usedFor ?? "" },
      clock.now(),
    );
    if (sources === null) return err({ kind: "DeckNotFound" });
    const saved =
      sources.find((source) => source.url === input.url) ?? sources[sources.length - 1] ?? null;
    return ok({ source: saved, totalCount: sources.length });
  }

  return { setProfile, setPrimer, saveSource };
}
