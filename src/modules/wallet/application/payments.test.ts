import { describe, expect, it, vi } from "vitest";
import { Cents, err, ok, UserId } from "@/shared/kernel";
import { inMemoryWalletServices } from "../testing/fakes";
import { spendMany } from "./payments";

const jack = UserId.of("jack");
const now = new Date("2026-01-07T10:00:00Z");

describe("spendMany", () => {
  it("brings the wallet up to date once, checks total affordance once, and appends all entries once", async () => {
    const setup = inMemoryWalletServices(["jack"]);
    const appendSpy = vi.spyOn(setup.services.wallets, "appendEntries");
    const balanceSpy = vi.spyOn(setup.services.wallets, "balance");
    const lockSpy = vi.spyOn(setup.services.wallets, "lockAccount");

    const result = await spendMany(setup.services, {
      userId: jack,
      now,
      items: [
        { amount: Cents.of(1200), kind: "purchase_single", note: null, ref: "store:1" },
        { amount: Cents.of(800), kind: "purchase_single", note: "second", ref: "store:2" },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toMatchObject({
        amount: -1200,
        kind: "purchase_single",
        ref: "store:1",
      });
      expect(result.value[1]).toMatchObject({
        amount: -800,
        kind: "purchase_single",
        note: "second",
        ref: "store:2",
      });
    }
    expect(lockSpy).toHaveBeenCalledTimes(1);
    expect(balanceSpy).toHaveBeenCalledTimes(1);
    // Once during bringUpToDate (starting_grant) and once for the batched spend entries.
    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(appendSpy).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ ref: "store:1", amount: -1200 }),
        expect.objectContaining({ ref: "store:2", amount: -800 }),
      ]),
    );
    expect(await setup.services.wallets.balance(jack)).toBe(3000);
  });

  it("refuses when total exceeds balance without appending any spend entries", async () => {
    const setup = inMemoryWalletServices(["jack"]);
    const result = await spendMany(setup.services, {
      userId: jack,
      now,
      items: [
        { amount: Cents.of(3000), kind: "purchase_single", note: null, ref: "store:1" },
        { amount: Cents.of(2500), kind: "purchase_single", note: null, ref: "store:2" },
      ],
    });

    expect(result).toEqual(
      err({ kind: "InsufficientFunds", balance: Cents.of(5000), required: Cents.of(5500) }),
    );
    expect(setup.services.wallets.entriesFor(jack).map((entry) => entry.kind)).toEqual([
      "starting_grant",
    ]);
    expect(await setup.services.wallets.balance(jack)).toBe(5000);
  });

  it("brings the wallet up to date and returns ok([]) when items is empty", async () => {
    const setup = inMemoryWalletServices(["jack"]);
    const result = await spendMany(setup.services, { userId: jack, now, items: [] });

    expect(result).toEqual(ok([]));
    expect(setup.services.wallets.entriesFor(jack).map((entry) => entry.kind)).toEqual([
      "starting_grant",
    ]);
  });
});
