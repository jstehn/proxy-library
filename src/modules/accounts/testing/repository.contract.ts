// Contract tests: one set of expectations that every PlayerRepository and InviteRepository
// must meet. Run against the in-memory fakes AND the Drizzle repositories, so the fakes used
// in fast tests are known to behave like the real thing (patterns.md #18).
import { beforeEach, describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import type {
  AccessTokenRepository,
  InviteRepository,
  PlayerRepository,
} from "../application/ports";
import type { DisplayName, Username } from "../domain/credentials";
import type { Invite, InviteCode } from "../domain/invite";
import { newPlayer, type Player } from "../domain/player";

export function testPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    ...newPlayer({
      userId: UserId.of(id),
      username: id as Username,
      displayName: `Player ${id}` as DisplayName,
      isAdmin: false,
      joinedAt: new Date("2026-01-01T12:00:00.000Z"),
    }),
    ...overrides,
  };
}

export type RepositoryHarness = {
  players: PlayerRepository;
  invites: InviteRepository;
  accessTokens: AccessTokenRepository;
  /** Creates what a player row depends on (Better Auth's user row); a no-op in memory. */
  createIdentity(player: Player): Promise<void>;
};

export function describeRepositoryContracts(
  implementation: string,
  setup: () => Promise<RepositoryHarness>,
) {
  let harness: RepositoryHarness;

  beforeEach(async () => {
    harness = await setup();
  });

  async function savePlayer(player: Player): Promise<Player> {
    await harness.createIdentity(player);
    await harness.players.insert(player);
    return player;
  }

  describe(`PlayerRepository contract (${implementation})`, () => {
    it("finds a saved player exactly as saved", async () => {
      const player = await savePlayer(testPlayer("jack", { isAdmin: true }));
      expect(await harness.players.findById(player.userId)).toEqual(player);
    });

    it("returns null for an unknown player", async () => {
      expect(await harness.players.findById(UserId.of("nobody"))).toBeNull();
    });

    it("saves updates to the flags", async () => {
      const player = await savePlayer(testPlayer("jack"));
      const updated: Player = {
        ...player,
        isAdmin: true,
        canSelfFund: true,
        disabledAt: new Date("2026-02-01T00:00:00.000Z"),
        mustChangePassword: true,
      };
      await harness.players.update(updated);
      expect(await harness.players.findById(player.userId)).toEqual(updated);
    });

    it("counts players and active admins", async () => {
      expect(await harness.players.countPlayers()).toBe(0);
      await savePlayer(testPlayer("admin1", { isAdmin: true }));
      await savePlayer(testPlayer("admin2", { isAdmin: true, disabledAt: new Date() }));
      await savePlayer(testPlayer("regular"));
      expect(await harness.players.countPlayers()).toBe(3);
      expect(await harness.players.countActiveAdmins()).toBe(1);
    });

    it("can take the accounts lock", async () => {
      await expect(harness.players.lockAccounts()).resolves.toBeUndefined();
    });
  });

  describe(`AccessTokenRepository contract (${implementation})`, () => {
    const at = (time: string) => new Date(`2026-11-07T${time}:00.000Z`);
    const newToken = (userId: UserId, hash: string) => ({
      userId,
      name: "LM Studio",
      prefix: hash.slice(0, 8),
      hash,
      scopes: ["read", "decks:write"] as const,
      createdAt: at("12:00"),
    });

    it("finds a live token by its hash, exactly as saved", async () => {
      const jack = await savePlayer(testPlayer("jack"));
      const token = await harness.accessTokens.insert(newToken(jack.userId, "hash-aaaaaaaa"));
      expect(token).toMatchObject({
        userId: jack.userId,
        name: "LM Studio",
        prefix: "hash-aaa",
        scopes: ["read", "decks:write"],
        createdAt: at("12:00"),
        lastUsedAt: null,
        revokedAt: null,
      });
      expect(await harness.accessTokens.findLiveByHash("hash-aaaaaaaa")).toEqual(token);
      expect(await harness.accessTokens.findLiveByHash("other")).toBeNull();
    });

    it("revokes only the owner's live token, once", async () => {
      const jack = await savePlayer(testPlayer("jack"));
      const amy = await savePlayer(testPlayer("amy"));
      const token = await harness.accessTokens.insert(newToken(jack.userId, "hash-1"));
      expect(await harness.accessTokens.revoke(token.id, amy.userId, at("12:05"))).toBe(false);
      expect(await harness.accessTokens.countLive(jack.userId)).toBe(1);
      expect(await harness.accessTokens.revoke(token.id, jack.userId, at("12:05"))).toBe(true);
      expect(await harness.accessTokens.revoke(token.id, jack.userId, at("12:06"))).toBe(false);
      expect(await harness.accessTokens.findLiveByHash("hash-1")).toBeNull();
      expect(await harness.accessTokens.countLive(jack.userId)).toBe(0);
    });

    it("revokes every live token of one player", async () => {
      const jack = await savePlayer(testPlayer("jack"));
      const amy = await savePlayer(testPlayer("amy"));
      await harness.accessTokens.insert(newToken(jack.userId, "hash-1"));
      await harness.accessTokens.insert(newToken(jack.userId, "hash-2"));
      await harness.accessTokens.insert(newToken(amy.userId, "hash-3"));
      expect(await harness.accessTokens.revokeAll(jack.userId, at("13:00"))).toBe(2);
      expect(await harness.accessTokens.countLive(jack.userId)).toBe(0);
      expect(await harness.accessTokens.countLive(amy.userId)).toBe(1);
    });

    it("records when a token was last used", async () => {
      const jack = await savePlayer(testPlayer("jack"));
      const token = await harness.accessTokens.insert(newToken(jack.userId, "hash-1"));
      await harness.accessTokens.touch(token.id, at("12:30"));
      expect((await harness.accessTokens.findLiveByHash("hash-1"))?.lastUsedAt).toEqual(
        at("12:30"),
      );
    });
  });

  describe(`InviteRepository contract (${implementation})`, () => {
    async function saveInvite(): Promise<Invite> {
      const admin = await savePlayer(testPlayer("admin", { isAdmin: true }));
      const invite: Invite = {
        code: "K7QM-2XPA-9TRD" as InviteCode,
        createdBy: admin.userId,
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
        expiresAt: new Date("2026-01-08T12:00:00.000Z"),
        usedBy: null,
        usedAt: null,
        revokedAt: null,
      };
      await harness.invites.insert(invite);
      return invite;
    }

    it("finds a saved invite exactly as saved", async () => {
      const invite = await saveInvite();
      expect(await harness.invites.findByCode(invite.code)).toEqual(invite);
    });

    it("returns null for an unknown code", async () => {
      expect(await harness.invites.findByCode("ZZZZ-ZZZZ-ZZZZ" as InviteCode)).toBeNull();
    });

    it("saves who used an invite, and when", async () => {
      const invite = await saveInvite();
      const newcomer = await savePlayer(testPlayer("newcomer"));
      const used: Invite = {
        ...invite,
        usedBy: newcomer.userId,
        usedAt: new Date("2026-01-02T00:00:00.000Z"),
      };
      await harness.invites.update(used);
      expect(await harness.invites.findByCode(invite.code)).toEqual(used);
    });
  });
}
