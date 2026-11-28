import type { PrintingId } from "@/modules/catalog";
import type { DeckId } from "@/modules/decks";
import type { ThemePreference, UserId } from "@/shared/kernel";
import type {
  FriendshipRepository,
  PlayerLookup,
  ProfileRepository,
  ShowcaseValidator,
  SocialServices,
} from "../application/ports";
import type { Friendship } from "../domain/friendship";
import type { PlayerProfile } from "../domain/profile";

function pairKey(a: UserId, b: UserId): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function fakeProfileRepository(initial: readonly PlayerProfile[] = []): ProfileRepository & {
  all(): PlayerProfile[];
  themeOf(userId: UserId): ThemePreference | null;
} {
  const map = new Map<string, PlayerProfile>(initial.map((p) => [p.userId, p]));
  const themes = new Map<string, ThemePreference>();
  return {
    async findByUserId(userId) {
      return map.get(userId) ?? null;
    },
    async save(profile) {
      map.set(profile.userId, profile);
    },
    async saveThemePreference(userId, preference) {
      themes.set(userId, preference);
    },
    all() {
      return [...map.values()];
    },
    themeOf(userId) {
      return themes.get(userId) ?? null;
    },
  };
}

function fakeFriendshipRepository(
  initial: readonly Friendship[] = [],
): FriendshipRepository & { all(): Friendship[] } {
  const map = new Map<string, Friendship>(
    initial.map((f) => [pairKey(f.requesterId, f.addresseeId), f]),
  );
  return {
    async findBetween(a, b) {
      return map.get(pairKey(a, b)) ?? null;
    },
    async insert(friendship) {
      map.set(pairKey(friendship.requesterId, friendship.addresseeId), friendship);
    },
    async markAccepted(requesterId, addresseeId, acceptedAt) {
      const key = pairKey(requesterId, addresseeId);
      const existing = map.get(key);
      if (existing) {
        map.set(key, { ...existing, status: "accepted", acceptedAt });
      }
    },
    async deleteBetween(a, b) {
      map.delete(pairKey(a, b));
    },
    all() {
      return [...map.values()];
    },
  };
}

function fakePlayerLookup(activeIds: Iterable<UserId>): PlayerLookup {
  const active = new Set<string>(activeIds);
  return {
    async isActivePlayer(userId) {
      return active.has(userId);
    },
  };
}

function fakeShowcaseValidator(options?: {
  ownedSharedDecks?: ReadonlyArray<{ ownerId: UserId; deckId: DeckId }>;
  existingPrintings?: Iterable<PrintingId>;
}): ShowcaseValidator {
  const decks = new Set((options?.ownedSharedDecks ?? []).map((d) => `${d.ownerId}::${d.deckId}`));
  const printings = options?.existingPrintings ? new Set<string>(options.existingPrintings) : null;
  return {
    async isOwnedSharedDeck(ownerId, deckId) {
      return decks.has(`${ownerId}::${deckId}`);
    },
    async allPrintingsExist(printingIds) {
      if (printings === null) return true;
      return printingIds.every((id) => printings.has(id));
    },
  };
}

export function fakeSocialServices(options?: {
  activePlayerIds?: Iterable<UserId>;
  ownedSharedDecks?: ReadonlyArray<{ ownerId: UserId; deckId: DeckId }>;
  existingPrintings?: Iterable<PrintingId>;
}): SocialServices {
  return {
    profiles: fakeProfileRepository(),
    friendships: fakeFriendshipRepository(),
    socialPlayers: fakePlayerLookup(options?.activePlayerIds ?? []),
    showcaseValidator: fakeShowcaseValidator({
      ownedSharedDecks: options?.ownedSharedDecks,
      existingPrintings: options?.existingPrintings,
    }),
  };
}
