import type { ActivityServices } from "@/modules/activity";
import type { Color, PrintingId, SetCode } from "@/modules/catalog";
import type { CollectionServices } from "@/modules/collection";
import type { DeckId, DecksServices } from "@/modules/decks";
import type { PacksServices, SeedSource } from "@/modules/packs";
import type { WalletServices } from "@/modules/wallet";
import type { Cents, Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { DraftCardFacts } from "../domain/auto-pick";
import type { Draft, DraftId, NewDraft } from "../domain/draft";

// Ports: what the draft use cases need from outside (design doc 17, section 6).

export interface DraftRepository {
  create(draft: NewDraft): Promise<DraftId>;
  /** The whole draft, its row locked until the transaction ends, or null. */
  lock(draftId: DraftId): Promise<Draft | null>;
  /** Writes whatever changed between `before` and `after` (both from the same `lock`). */
  save(before: Draft, after: Draft): Promise<void>;
  /** The lobby or running draft a player has a seat in (rule 1), or null. */
  activeDraftOf(userId: UserId): Promise<DraftId | null>;
  /** The lobbies a player has a seat in (for a reset). */
  lobbiesWith(userId: UserId): Promise<DraftId[]>;
  /** Running drafts with a seat whose deadline is at or before `now`: the worker's work. */
  withDeadlineBefore(now: Date): Promise<DraftId[]>;
  /** Remembers the deck a finished draft made for a player, for the "open your deck" link. */
  setDeckOf(draftId: DraftId, userId: UserId, deckId: DeckId): Promise<void>;
}

/** What the drafts module needs to know from the catalog and the store. */
export interface DraftCatalog {
  /** The set's name if this booster can be drafted (an enabled set, a draft-style booster). */
  draftable(setCode: SetCode, boosterType: string): Promise<{ setName: string } | null>;
  /** The set's name (its code if the catalog no longer has it). */
  setName(setCode: SetCode): Promise<string>;
  /** The store's price of one pack (MSRP, ADR 0014), or null if it has none. */
  packPrice(setCode: SetCode, boosterType: string): Promise<Cents | null>;
  cardFacts(printingIds: readonly PrintingId[]): Promise<Map<PrintingId, DraftCardFacts>>;
  /** A basic land printing per color, preferring the draft's own set (for the suggested build). */
  basicLands(setCode: SetCode): Promise<Map<Color, PrintingId>>;
}

/** Tells browsers a draft changed (ADR 0018). Sent only if the transaction commits. */
export interface DraftNotifier {
  changed(draftId: DraftId, version: number): Promise<void>;
}

/** Everything a draft touches in one transaction. */
export type DraftsServices = {
  drafts: DraftRepository;
  draftCatalog: DraftCatalog;
  draftNotifier: DraftNotifier;
} & WalletServices &
  CollectionServices &
  PacksServices &
  DecksServices &
  ActivityServices;

export type DraftsDependencies = {
  unitOfWork: UnitOfWork<DraftsServices>;
  clock: Clock;
  seeds: SeedSource;
};
