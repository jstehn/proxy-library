import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { Cents, err, UserId } from "@/shared/kernel";
import { manualClock } from "@/shared/kernel/testing";
import { DEFAULT_TEST_SETTINGS, inMemoryWalletServices } from "../testing/fakes";
import { makeWallet } from "./make-wallet";

// Use-case tests: real wallet code against in-memory fakes, with a clock we control.
// DEFAULT_TEST_SETTINGS: $20 every Monday 00:00 UTC, $50 starting grant, $100 self-fund limit.

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

function actor(id: string, options: Partial<Actor> = {}): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin: false,
    canSelfFund: false,
    mustChangePassword: false,
    ...options,
  };
}

const admin = actor("admin", { isAdmin: true });
const jack = actor("jack");

let setup: ReturnType<typeof inMemoryWalletServices>;
let clock: ReturnType<typeof manualClock>;
let wallet: ReturnType<typeof makeWallet>;

beforeEach(() => {
  setup = inMemoryWalletServices(["admin", "jack"]);
  clock = manualClock("2026-01-07T10:00:00Z"); // a Wednesday
  wallet = makeWallet({ unitOfWork: setup.unitOfWork, clock });
});

const kinds = (userId: UserId) => setup.services.wallets.entriesFor(userId).map((e) => e.kind);

describe("refreshWallet: opening, starting grant and allowances", () => {
  it("opens a new wallet with the starting grant, exactly once (rule 7)", async () => {
    expect(await wallet.refreshWallet(jack.userId)).toBe(5000);
    expect(await wallet.refreshWallet(jack.userId)).toBe(5000);
    expect(kinds(jack.userId)).toEqual(["starting_grant"]);
  });

  it("pays nothing until the first payday after the wallet opened (rule 8)", async () => {
    await wallet.refreshWallet(jack.userId);
    clock.advanceBy(4 * DAY); // Sunday
    expect(await wallet.refreshWallet(jack.userId)).toBe(5000);
    clock.advanceBy(1 * DAY); // Monday 10:00, past the 00:00 payday
    expect(await wallet.refreshWallet(jack.userId)).toBe(7000);
  });

  it("pays every missed payday once, each dated to its own payday (rule 6)", async () => {
    await wallet.refreshWallet(jack.userId);
    clock.advanceBy(3 * WEEK);
    expect(await wallet.refreshWallet(jack.userId)).toBe(5000 + 3 * 2000);

    const allowances = setup.services.wallets
      .entriesFor(jack.userId)
      .filter((entry) => entry.kind === "allowance")
      .map((entry) => entry.effectiveAt.toISOString());
    expect(allowances).toEqual([
      "2026-01-12T00:00:00.000Z",
      "2026-01-19T00:00:00.000Z",
      "2026-01-26T00:00:00.000Z",
    ]);

    // Refreshing again straight away pays nothing more.
    expect(await wallet.refreshWallet(jack.userId)).toBe(11_000);
  });

  it("opens and brings up to date every player's wallet", async () => {
    await wallet.refreshAllWallets();
    expect(kinds(admin.userId)).toEqual(["starting_grant"]);
    expect(kinds(jack.userId)).toEqual(["starting_grant"]);
  });
});

describe("grantMoney and correctBalance", () => {
  it("lets an admin give money, with a note", async () => {
    const result = await wallet.grantMoney(admin, {
      userId: jack.userId,
      amount: Cents.of(2500),
      note: "Won Friday's draft",
    });
    expect(result.ok && result.value.note).toBe("Won Friday's draft");
    expect(await wallet.refreshWallet(jack.userId)).toBe(7500);
  });

  it("requires a note, a sensible amount, and an existing player", async () => {
    const give = (amount: number, note: string, userId = jack.userId) =>
      wallet.grantMoney(admin, { userId, amount: Cents.of(amount), note });

    expect((await give(2500, "  ")).ok || "note").toBe("note");
    expect(await give(0, "zero")).toEqual(
      err({ kind: "AmountInvalid", reason: "must be more than $0.00" }),
    );
    expect(await give(2_000_000, "too much")).toEqual(
      err({ kind: "AmountInvalid", reason: "must be at most $10,000.00" }),
    );
    expect(await give(100, "who?", UserId.of("ghost"))).toEqual(err({ kind: "PlayerNotFound" }));
  });

  it("takes money away, but never below $0 (rule 3)", async () => {
    await wallet.refreshWallet(jack.userId); // $50 starting grant
    const tooMuch = await wallet.correctBalance(admin, {
      userId: jack.userId,
      amount: Cents.of(5001),
      note: "oops",
    });
    expect(tooMuch).toEqual(err({ kind: "InsufficientFunds", balance: 5000, required: 5001 }));

    const fine = await wallet.correctBalance(admin, {
      userId: jack.userId,
      amount: Cents.of(5000),
      note: "undo mistaken grant",
    });
    expect(fine.ok && fine.value.amount).toBe(-5000);
    expect(await wallet.refreshWallet(jack.userId)).toBe(0);
  });

  it("counts allowances that are due before checking the balance", async () => {
    await wallet.refreshWallet(jack.userId);
    clock.advanceBy(WEEK); // one $20 allowance is now due but not yet paid
    const result = await wallet.correctBalance(admin, {
      userId: jack.userId,
      amount: Cents.of(7000),
      note: "take everything",
    });
    expect(result.ok).toBe(true);
  });

  it("is admin-only (rule 10)", async () => {
    const input = { userId: jack.userId, amount: Cents.of(100), note: "sneaky" };
    expect(await wallet.grantMoney(jack, input)).toEqual(err({ kind: "Forbidden" }));
    expect(await wallet.correctBalance(jack, input)).toEqual(err({ kind: "Forbidden" }));
  });
});

describe("addOwnFunds (rule 11)", () => {
  const funder = actor("jack", { canSelfFund: true });

  it("needs the self-funding permission", async () => {
    expect(await wallet.addOwnFunds(jack, { amount: Cents.of(100), note: "" })).toEqual(
      err({ kind: "SelfFundingNotAllowed" }),
    );
  });

  it("adds up to the per-deposit limit, and no more", async () => {
    const added = await wallet.addOwnFunds(funder, { amount: Cents.of(10_000), note: "" });
    expect(added.ok && added.value.kind).toBe("self_fund");
    expect(await wallet.addOwnFunds(funder, { amount: Cents.of(10_001), note: "" })).toEqual(
      err({ kind: "SelfFundLimitExceeded", limit: 10_000 }),
    );
  });
});

describe("updateEconomySettings (rule 9)", () => {
  it("pays everyone under the old settings first, then applies the new ones", async () => {
    await wallet.refreshWallet(jack.userId);
    clock.advanceBy(WEEK); // one $20 payday has passed

    const updated = await wallet.updateEconomySettings(admin, {
      ...DEFAULT_TEST_SETTINGS,
      allowance: Cents.of(3000),
    });
    expect(updated.ok).toBe(true);
    expect(await wallet.refreshWallet(jack.userId)).toBe(5000 + 2000); // old amount

    clock.advanceBy(WEEK);
    expect(await wallet.refreshWallet(jack.userId)).toBe(5000 + 2000 + 3000); // new amount
  });

  it("is admin-only, and rejects invalid settings", async () => {
    expect(await wallet.updateEconomySettings(jack, DEFAULT_TEST_SETTINGS)).toEqual(
      err({ kind: "Forbidden" }),
    );
    const result = await wallet.updateEconomySettings(admin, {
      ...DEFAULT_TEST_SETTINGS,
      allowancePeriodDays: 0,
    });
    expect(result.ok || result.error.kind).toBe("SettingsInvalid");
  });
});
