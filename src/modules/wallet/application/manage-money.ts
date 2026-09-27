import type { Actor } from "@/modules/accounts";
import { err, ok, type Cents, type Result, type UserId } from "@/shared/kernel";
import type {
  AmountInvalid,
  Forbidden,
  InsufficientFunds,
  NoteInvalid,
  PlayerNotFound,
  SelfFundingNotAllowed,
  SelfFundLimitExceeded,
} from "../domain/errors";
import {
  checkAmount,
  checkCanAfford,
  checkNote,
  ledgerEntry,
  type LedgerEntry,
} from "../domain/ledger";
import type { WalletDependencies } from "./ports";
import { bringUpToDate } from "./refresh";

export type GrantMoneyError = Forbidden | AmountInvalid | NoteInvalid | PlayerNotFound;
export type CorrectBalanceError = GrantMoneyError | InsufficientFunds;
export type AddOwnFundsError =
  SelfFundingNotAllowed | AmountInvalid | NoteInvalid | SelfFundLimitExceeded;

type AdminMoneyInput = { userId: UserId; amount: Cents; note: string };

/** An admin gives a player money, with a note saying why (rule 10). */
export function makeGrantMoney(dependencies: WalletDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function grantMoney(
    actor: Actor,
    input: AdminMoneyInput,
  ): Promise<Result<LedgerEntry, GrantMoneyError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    const amount = checkAmount(input.amount);
    if (!amount.ok) return amount;
    const note = checkNote(input.note, { required: true });
    if (!note.ok) return note;

    return unitOfWork.run<LedgerEntry, GrantMoneyError>(async (services) => {
      if (!(await services.playerDirectory.exists(input.userId))) {
        return err({ kind: "PlayerNotFound" });
      }
      const now = clock.now();
      await bringUpToDate(services, input.userId, now);

      const entry = ledgerEntry({
        userId: input.userId,
        kind: "grant",
        size: amount.value,
        note: note.value,
        createdBy: actor.userId,
        effectiveAt: now,
      });
      await services.wallets.appendEntries([entry]);
      return ok(entry);
    });
  }

  return grantMoney;
}

/** An admin takes money away, with a note. Never below $0 (rules 3 and 10). */
export function makeCorrectBalance(dependencies: WalletDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function correctBalance(
    actor: Actor,
    input: AdminMoneyInput,
  ): Promise<Result<LedgerEntry, CorrectBalanceError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    const amount = checkAmount(input.amount);
    if (!amount.ok) return amount;
    const note = checkNote(input.note, { required: true });
    if (!note.ok) return note;

    return unitOfWork.run<LedgerEntry, CorrectBalanceError>(async (services) => {
      if (!(await services.playerDirectory.exists(input.userId))) {
        return err({ kind: "PlayerNotFound" });
      }
      const now = clock.now();
      // Brings the wallet up to date AND locks it, so the balance can't change between
      // checking it and taking the money (the race condition from lesson 02).
      await bringUpToDate(services, input.userId, now);

      const affordable = checkCanAfford(await services.wallets.balance(input.userId), amount.value);
      if (!affordable.ok) return affordable;

      const entry = ledgerEntry({
        userId: input.userId,
        kind: "correction",
        size: amount.value,
        note: note.value,
        createdBy: actor.userId,
        effectiveAt: now,
      });
      await services.wallets.appendEntries([entry]);
      return ok(entry);
    });
  }

  return correctBalance;
}

/** A player with permission adds money to their own wallet (rule 11). */
export function makeAddOwnFunds(dependencies: WalletDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function addOwnFunds(
    actor: Actor,
    input: { amount: Cents; note: string },
  ): Promise<Result<LedgerEntry, AddOwnFundsError>> {
    if (!actor.canSelfFund) return err({ kind: "SelfFundingNotAllowed" });
    const note = checkNote(input.note, { required: false });
    if (!note.ok) return note;

    return unitOfWork.run<LedgerEntry, AddOwnFundsError>(async (services) => {
      const settings = await services.economy.get();
      const amount = checkAmount(input.amount);
      if (!amount.ok) return amount;
      if (amount.value > settings.selfFundLimit) {
        return err({ kind: "SelfFundLimitExceeded", limit: settings.selfFundLimit });
      }

      const now = clock.now();
      await bringUpToDate(services, actor.userId, now);
      const entry = ledgerEntry({
        userId: actor.userId,
        kind: "self_fund",
        size: amount.value,
        note: note.value,
        createdBy: actor.userId,
        effectiveAt: now,
      });
      await services.wallets.appendEntries([entry]);
      return ok(entry);
    });
  }

  return addOwnFunds;
}
