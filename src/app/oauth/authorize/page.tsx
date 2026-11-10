import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MAX_LIVE_TOKENS } from "@/modules/accounts";
import { problemWords } from "@/app/_oauth/http";
import { getContainer } from "@/server/container";
import { signInPathFor } from "@/server/next-path";
import { getCurrentActor, requireActor } from "@/server/session";
import { Alert } from "@/ui/form";
import { decideAction } from "./actions";
import { PARAMETER_NAMES, queryOf, readParameters } from "./parameters";

// The OAuth approval page (design doc 30): an app such as claude.ai's connector asks to act as
// you; you choose what it may do. Approving makes an access token for it (design doc 28).

export const metadata: Metadata = { title: "Connect an app" };

const SCOPE_CHOICES = [
  { scope: "decks:write", words: "build and edit your decks" },
  { scope: "wishlist:write", words: "add to and change your wishlist" },
] as const;

export default async function AuthorizePage(props: PageProps<"/oauth/authorize">) {
  const query = await props.searchParams;
  const parameters = readParameters((name) => query[name]);
  if ((await getCurrentActor()) === null) {
    redirect(signInPathFor(`/oauth/authorize?${queryOf(parameters)}`));
  }
  await requireActor(); // and change a reset password first

  const checked = await getContainer().accounts.checkAuthorizationRequest(parameters);
  if (!checked.ok && checked.error.kind === "AuthorizationRefused") {
    // A known app and address with a bad request: tell the app (RFC 6749, section 4.1.2.1).
    const url = new URL(checked.error.redirectUri);
    url.searchParams.set("error", checked.error.error);
    url.searchParams.set("error_description", checked.error.description);
    if (checked.error.state !== null) url.searchParams.set("state", checked.error.state);
    redirect(url.toString());
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      {checked.ok ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold break-words">
              Connect {checked.value.client.name}?
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              It wants to use your Proxy Library account as you. Approving sends you back to{" "}
              <strong className="break-all text-zinc-900 dark:text-zinc-100">
                {new URL(checked.value.redirectUri).host}
              </strong>
              . Only approve if you just asked to connect it there.
            </p>
          </div>
          {query.problem === "too-many-tokens" && (
            <Alert tone="error">
              You already have {MAX_LIVE_TOKENS} access tokens. Revoke one on your Account page,
              then try again.
            </Alert>
          )}
          <form action={decideAction} className="flex flex-col gap-4">
            {Object.entries(PARAMETER_NAMES).map(([key, name]) => {
              const value = parameters[key as keyof typeof PARAMETER_NAMES];
              return value === null ? null : (
                <input key={name} type="hidden" name={name} value={value} />
              );
            })}
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="font-medium">It may</legend>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked disabled /> read your account, cards, decks and
                wishlist
              </label>
              {SCOPE_CHOICES.map((choice) => (
                <label key={choice.scope} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="scope"
                    value={choice.scope}
                    defaultChecked={checked.value.scopes.includes(choice.scope)}
                  />{" "}
                  {choice.words}
                </label>
              ))}
              <span className="text-xs text-zinc-500">
                It can never buy, sell, open packs, trade or delete anything. You can disconnect it
                any time under Account → Access tokens.
              </span>
            </fieldset>
            <div className="flex gap-3">
              <button
                type="submit"
                name="decision"
                value="approve"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Approve
              </button>
              <button
                type="submit"
                name="decision"
                value="deny"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Deny
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Can&apos;t connect this app</h1>
          <Alert tone="error">
            {problemWords(
              checked.error.kind === "UnknownClient" ? "UnknownClient" : "RedirectUriNotRegistered",
            )}
          </Alert>
        </>
      )}
    </main>
  );
}
