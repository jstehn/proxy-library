import Link from "next/link";
import { currentEconomySettings, walletSummary } from "@/modules/wallet";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { CONFIRMATION_WORD } from "./confirmation";
import { StartOverForm } from "./start-over-form";

/** The player's own account: their password, and starting over. */
export default async function AccountPage() {
  const actor = await requireActor();
  const { db } = getContainer();
  const [wallet, economy] = await Promise.all([
    walletSummary(db, actor.userId),
    currentEconomySettings(db),
  ]);
  const startingAmount = Cents.format(economy.startingGrant);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {actor.displayName} <span className="text-zinc-500">@{actor.username}</span>
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Password</h2>
        <Link href="/account/password" className="w-fit underline">
          Change password
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-red-300 p-4 dark:border-red-900">
        <h2 className="font-medium">Start over</h2>
        <p className="text-sm">
          Returns your account to how it was when it was new.{" "}
          <strong>This can&apos;t be undone.</strong>
        </p>
        <ul className="list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>
            <strong>Every card is wiped</strong>: your whole collection, your sealed product (opened
            or not) and your decks.
          </li>
          <li>Trades waiting for an answer are cancelled or declined.</li>
          <li>
            <strong>Your balance is set to the starting amount, {startingAmount}.</strong> It does
            not recover all your funds: nothing you spent is refunded, and money above{" "}
            {startingAmount} (saved allowances, sales, trades) is lost. You have{" "}
            <strong>{Cents.format(wallet.balance)}</strong> now.
          </li>
          <li>Your weekly allowance carries on as before.</li>
        </ul>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          To confirm, type <strong>{CONFIRMATION_WORD}</strong> below.
        </p>
        <StartOverForm />
      </section>
    </main>
  );
}
