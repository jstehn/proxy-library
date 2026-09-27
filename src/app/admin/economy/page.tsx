import { currentEconomySettings, MAX_ALLOWANCE_PERIOD_DAYS, nextPayday } from "@/modules/wallet";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { LocalTime } from "@/ui/local-time";
import { EconomyForm } from "./economy-form";

export default async function AdminEconomyPage() {
  await requireAdminActor();
  const { db, clock } = getContainer();
  const settings = await currentEconomySettings(db);
  const payday = nextPayday(
    { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
    clock.now(),
  );

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Economy</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {Cents.format(settings.allowance)} every {settings.allowancePeriodDays} days. Next payday:{" "}
        <LocalTime iso={payday.toISOString()} withTime />. Changes apply from now on: allowances
        already due are paid at the old amount first.
      </p>
      <EconomyForm
        maxPeriodDays={MAX_ALLOWANCE_PERIOD_DAYS}
        values={{
          allowance: Cents.toPlainDollars(settings.allowance),
          allowancePeriodDays: settings.allowancePeriodDays,
          anchorIso: settings.allowanceAnchor.toISOString(),
          startingGrant: Cents.toPlainDollars(settings.startingGrant),
          selfFundLimit: Cents.toPlainDollars(settings.selfFundLimit),
        }}
      />
    </main>
  );
}
