import Link from "next/link";
import { decksFor, FORMATS } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { createDeckAction } from "./actions";
import { FORMAT_LABELS } from "./labels";

const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

export default async function DecksPage(props: PageProps<"/decks">) {
  const actor = await requireActor();
  const decks = await decksFor(getContainer().db, actor.userId);
  const error = (await props.searchParams).error;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Decks</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Build from the cards you own, then print proxies to play with. A deck can use every copy
          you own, even if another deck uses them too.
        </p>
      </header>
      {typeof error === "string" && <Alert tone="error">{error}</Alert>}

      <form action={createDeckAction} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          placeholder="New deck name"
          aria-label="Deck name"
          required
          maxLength={60}
          className={`${field} w-64`}
        />
        <select name="format" aria-label="Format" defaultValue="commander" className={field}>
          {FORMATS.map((format) => (
            <option key={format} value={format}>
              {FORMAT_LABELS[format]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Create deck
        </button>
      </form>

      {decks.length === 0 ? (
        <p className="text-sm text-zinc-500">No decks yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {decks.map((deck) => (
            <li key={deck.id} className="flex flex-wrap items-center gap-3 py-3">
              <Link href={`/decks/${deck.id}`} className="font-medium underline">
                {deck.name}
              </Link>
              <span className="text-sm text-zinc-500">
                {FORMAT_LABELS[deck.format]} · {deck.cards} cards
              </span>
              {deck.short > 0 ? (
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                  short {deck.short}
                </span>
              ) : (
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
                  all owned
                </span>
              )}
              <span className="flex-1" />
              <span className="text-xs text-zinc-500">
                changed <LocalTime iso={deck.updatedAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
