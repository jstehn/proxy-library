import { PrintingId, type Color, type SetCode } from "@/modules/catalog";
import type { DeckId } from "@/modules/decks";
import { Cents, type UserId } from "@/shared/kernel";
import type { DraftCatalog, DraftNotifier, DraftRepository } from "../application/ports";
import type { DraftCardFacts } from "../domain/auto-pick";
import type { OwnedBasic } from "../domain/basics";
import { DraftId, isUnfinished, type Draft, type NewDraft } from "../domain/draft";

// In-memory stand-ins for the drafts ports.

export function inMemoryDraftRepository() {
  const drafts = new Map<DraftId, Draft>();
  const decks = new Map<string, DeckId>();
  let lastId = 0;

  const repository: DraftRepository = {
    async create(draft: NewDraft) {
      const id = DraftId.of(++lastId);
      drafts.set(id, { ...draft, id });
      return id;
    },
    async lock(draftId) {
      return drafts.get(draftId) ?? null;
    },
    async save(_before, after) {
      drafts.set(after.id, after);
    },
    async activeDraftOf(userId) {
      const found = [...drafts.values()].find(
        (draft) => isUnfinished(draft) && draft.seats.some((seat) => seat.userId === userId),
      );
      return found?.id ?? null;
    },
    async lobbiesWith(userId) {
      return [...drafts.values()]
        .filter(
          (draft) => draft.status === "lobby" && draft.seats.some((seat) => seat.userId === userId),
        )
        .map((draft) => draft.id);
    },
    async withDeadlineBefore(now) {
      return [...drafts.values()]
        .filter(
          (draft) =>
            draft.status === "drafting" &&
            draft.seats.some((seat) => seat.deadline !== null && seat.deadline <= now),
        )
        .map((draft) => draft.id);
    },
    async setDeckOf(draftId, userId, deckId) {
      decks.set(`${draftId}/${userId}`, deckId);
    },
  };
  return {
    ...repository,
    get: (draftId: DraftId) => drafts.get(draftId),
    deckOf: (draftId: DraftId, userId: UserId) => decks.get(`${draftId}/${userId}`),
  };
}

const BASICS: ReadonlyArray<[Color, string]> = [
  ["W", "basic-plains"],
  ["U", "basic-island"],
  ["B", "basic-swamp"],
  ["R", "basic-mountain"],
  ["G", "basic-forest"],
];

/** A catalog where only the sample booster (TST play) can be drafted, at $5.49 a pack. */
export function inMemoryDraftCatalog(
  facts: ReadonlyMap<PrintingId, DraftCardFacts>,
  /** The basics a player owns; tests usually read them from a collection fake. */
  ownedBasicsOf: (userId: UserId) => Map<Color, OwnedBasic[]> = () => new Map(),
) {
  const prices = new Map<string, Cents>([["TST/play", Cents.of(549)]]);
  const catalog: DraftCatalog = {
    async draftable(setCode: SetCode, boosterType: string) {
      return setCode === "TST" && boosterType === "play" ? { setName: "Test Set" } : null;
    },
    async setName(setCode) {
      return setCode === "TST" ? "Test Set" : setCode;
    },
    async packPrice(setCode, boosterType) {
      return prices.get(`${setCode}/${boosterType}`) ?? null;
    },
    async cardFacts(printingIds) {
      const found = new Map<PrintingId, DraftCardFacts>();
      for (const printingId of printingIds) {
        const each = facts.get(printingId);
        if (each !== undefined) found.set(printingId, each);
      }
      return found;
    },
    async basicLands() {
      return new Map(BASICS.map(([color, id]) => [color, PrintingId.of(id)]));
    },
    async ownedBasics(userId) {
      return ownedBasicsOf(userId);
    },
  };
  return {
    ...catalog,
    /** The basic land printings the fake hands out, so a deck fake can know them. */
    basicPrintings: BASICS.map(([, id]) => id),
    /** The fake's basic land printing for each color. */
    basicPrinting: (color: Color) => BASICS.find(([each]) => each === color)?.[1] ?? "",
    removePrice: (setCode: string, boosterType: string) =>
      prices.delete(`${setCode}/${boosterType}`),
  };
}

/** Remembers every notification, in order. */
export function recordingNotifier() {
  const sent: Array<{ draftId: DraftId; version: number }> = [];
  const notifier: DraftNotifier = {
    async changed(draftId, version) {
      sent.push({ draftId, version });
    },
  };
  return { ...notifier, sent };
}
