import Link from "next/link";
import { Cents } from "@/shared/kernel";
import { InstallAppButton } from "../_components/install-app-button";
import { CONFIRMATION_WORD } from "./confirmation";
import { StartOverForm } from "./start-over-form";
import { readPage } from "@/server/page-instance";
import { describeExternalLinkError } from "@/modules/accounts";
import { externalSignInName } from "@/server/session";
import { Alert, SubmitButton } from "@/ui/form";
import { linkExternalAction, unlinkExternalAction } from "./external-actions";

/** The player's own account: their password, and starting over. */
export default async function AccountPage(props: PageProps<"/account">) {
  const { actor, reads } = await readPage();
  const externalName = externalSignInName();
  const external = externalName === null ? null : await reads.accounts.externalSignInStatus(actor);
  const query = await props.searchParams;
  const linkError = describeExternalLinkError(
    typeof query.error === "string" ? query.error : undefined,
  );

  const [wallet, economy] = await Promise.all([
    reads.wallet.summary(actor),
    reads.wallet.economySettings(),
  ]);
  const startingAmount = Cents.format(economy.startingGrant);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {actor.displayName} <span className="text-muted">@{actor.username}</span>
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Profile</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Share your bio, favorite colors and formats, showcase decks, and privacy preferences.
        </p>
        <div className="flex gap-4">
          <Link href={`/players/${actor.username}`} className="w-fit underline">
            View profile
          </Link>
          <Link href="/account/profile" className="w-fit underline">
            Edit profile
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Password</h2>
        <Link href="/account/password" className="w-fit underline">
          Change password
        </Link>
      </section>

      {externalName !== null && external !== null && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Sign in with {externalName}</h2>
          {linkError !== null && <Alert tone="error">{linkError}</Alert>}
          {external.linked ? (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Your {externalName} account is linked. You can still sign in with your password.
              </p>
              <form action={unlinkExternalAction}>
                <SubmitButton tone="secondary" pendingText="Unlinking…">
                  Unlink {externalName}
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Link your {externalName} account to sign in with it. You will be sent there to sign
                in, then back here.
              </p>
              <form action={linkExternalAction}>
                <SubmitButton tone="secondary" pendingText="Opening…">
                  Link {externalName}
                </SubmitButton>
              </form>
            </>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Connect an LLM</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Let an AI assistant look at your cards and help build decks, with an access token.
        </p>
        <Link href="/account/tokens" className="w-fit underline">
          Access tokens
        </Link>
      </section>

      <InstallAppButton />

      <section className="flex flex-col gap-3 rounded-lg border border-red-300 p-4 dark:border-red-900">
        <h2 className="font-medium">Start over</h2>
        <p className="text-sm">
          Returns your account to how it was when it was new.{" "}
          <strong>This can&apos;t be undone.</strong>
        </p>
        <ul className="list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>
            <strong>Every card is wiped</strong>: your whole collection, your sealed product (opened
            or not), your decks and your wishlist.
          </li>
          <li>Trades waiting for an answer are cancelled or declined.</li>
          <li>
            <strong>Your balance is set to the starting amount, {startingAmount}.</strong> It does
            not recover all your funds: nothing you spent is refunded, and money above{" "}
            {startingAmount} (saved allowances, sales, trades) is lost. You have{" "}
            <strong>{Cents.format(wallet.balance)}</strong> now.
          </li>
          <li>
            Your money totals (spent, self-funded, …) start again from zero. Your history keeps
            everything.
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
