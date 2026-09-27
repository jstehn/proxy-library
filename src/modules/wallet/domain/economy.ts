import { Cents, err, ok, type Result, type UserId } from "@/shared/kernel";
import type { SettingsInvalid } from "./errors";
import { MAX_ENTRY_AMOUNT } from "./ledger";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
export const MAX_ALLOWANCE_PERIOD_DAYS = 365;

/** The admin-editable numbers that drive the economy. */
export type EconomySettings = Readonly<{
  allowance: Cents; // paid every payday; $0 pauses allowances
  allowancePeriodDays: number;
  allowanceAnchor: Date; // one payday; the others are anchor ± N × period
  startingGrant: Cents; // paid once when a wallet opens; $0 means none
  selfFundLimit: Cents; // the most one self-funding deposit may add
}>;

/** A player's wallet row: the lock target for money changes, and how far allowances are paid. */
export type WalletAccount = Readonly<{
  userId: UserId;
  allowancePaidThrough: Date; // every payday up to and including this moment has been paid
  openedAt: Date;
}>;

/**
 * Every payday p with `after < p ≤ upTo`, oldest first.
 *
 * Paydays are `anchor + k × period` for every whole number k, including negative ones, so the
 * anchor may be any past or future payday. This is the entire allowance rule.
 */
export function paydaysBetween(
  schedule: { anchor: Date; periodDays: number },
  after: Date,
  upTo: Date,
): Date[] {
  const period = schedule.periodDays * DAY_IN_MILLISECONDS;
  const anchor = schedule.anchor.getTime();

  // The first k whose payday is strictly after `after`, and the last k whose payday is at or
  // before `upTo`.
  const firstK = Math.floor((after.getTime() - anchor) / period) + 1;
  const lastK = Math.floor((upTo.getTime() - anchor) / period);

  const paydays: Date[] = [];
  for (let k = firstK; k <= lastK; k++) paydays.push(new Date(anchor + k * period));
  return paydays;
}

/** The next payday strictly after `now` (for showing "next allowance on …"). */
export function nextPayday(schedule: { anchor: Date; periodDays: number }, now: Date): Date {
  const period = schedule.periodDays * DAY_IN_MILLISECONDS;
  const anchor = schedule.anchor.getTime();
  const k = Math.floor((now.getTime() - anchor) / period) + 1;
  return new Date(anchor + k * period);
}

export function checkSettings(settings: EconomySettings): Result<EconomySettings, SettingsInvalid> {
  const { allowance, allowancePeriodDays, startingGrant, selfFundLimit } = settings;
  const withinMax = (amount: Cents) => amount >= 0 && amount <= MAX_ENTRY_AMOUNT;

  if (!withinMax(allowance)) {
    return invalid(`Allowance must be $0.00 to ${Cents.format(MAX_ENTRY_AMOUNT)}.`);
  }
  if (!withinMax(startingGrant)) {
    return invalid(`Starting grant must be $0.00 to ${Cents.format(MAX_ENTRY_AMOUNT)}.`);
  }
  if (!withinMax(selfFundLimit) || selfFundLimit === 0) {
    return invalid(`Self-funding limit must be $0.01 to ${Cents.format(MAX_ENTRY_AMOUNT)}.`);
  }
  const isValidPeriod =
    Number.isInteger(allowancePeriodDays) &&
    allowancePeriodDays >= 1 &&
    allowancePeriodDays <= MAX_ALLOWANCE_PERIOD_DAYS;
  if (!isValidPeriod) {
    return invalid(`Allowance period must be 1 to ${MAX_ALLOWANCE_PERIOD_DAYS} days.`);
  }
  if (Number.isNaN(settings.allowanceAnchor.getTime())) {
    return invalid("Payday must be a valid date.");
  }
  return ok(settings);
}

function invalid(reason: string): Result<never, SettingsInvalid> {
  return err({ kind: "SettingsInvalid", reason });
}
