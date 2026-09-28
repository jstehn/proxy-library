import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BOARDS,
  deckProblems,
  deckStats,
  mainType,
  TYPE_ORDER,
  deckView,
  FORMATS,
  type Board,
  type DeckLine,
} from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Alert } from "@/ui/form";
import { deleteDeckAction, importListAction, setEntryAction, updateDeckAction } from "../actions";
import { FORMAT_LABELS, problemText } from "../labels";
import { CardSearch } from "./card-search";

const BOARD_TITLES: Record<Board, string> = {
  commander: "Commander",
  main: "Main deck",
  side: "Sideboard",
};
const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const smallButton = "rounded border border-zinc-300 px-2 text-sm leading-6 dark:border-zinc-700";

/** The mana curve as bars, plus card types and the average mana value. */
function StatsPanel(props: { lines: readonly DeckLine[] }) {
  const stats = deckStats(props.lines);
  const tallest = Math.max(...stats.curve, 1);
  return (
    <section aria-label="Deck statistics" className="flex flex-wrap items-end gap-8">
      <div className="flex flex-col gap-1">
        <div
          className="flex h-20 items-end gap-1"
          role="img"
          aria-label={`Mana curve: ${stats.curve.join(", ")}`}
        >
          {stats.curve.map((count, manaValue) => (
            <div
              key={manaValue}
              className="flex w-7 flex-col items-center justify-end gap-0.5 text-[10px] tabular-nums"
            >
              {count > 0 && <span>{count}</span>}
              <div
                className="w-full rounded-t bg-sky-500 dark:bg-sky-400"
                style={{ height: `${(count / tallest) * 56}px` }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-1 text-[10px] text-zinc-500">
          {stats.curve.map((_, manaValue) => (
            <span key={manaValue} className="w-7 text-center">
              {manaValue === 7 ? "7+" : manaValue}
            </span>
          ))}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {[...TYPE_ORDER, "Other"]
          .filter((type) => (stats.types[type] ?? 0) > 0)
          .map((type) => (
            <div key={type} className="flex gap-1">
              <dt className="text-zinc-500">{type}</dt>
              <dd className="tabular-nums">{stats.types[type]}</dd>
            </div>
          ))}
        <div className="flex gap-1">
          <dt className="text-zinc-500">Average mana value</dt>
          <dd className="tabular-nums">{stats.averageManaValue.toFixed(2)}</dd>
        </div>
      </dl>
    </section>
  );
}

function EntryButtons(props: { deckId: number; line: DeckLine; q: string }) {
  const { line } = props;
  const form = (quantity: number, label: string, text: string) => (
    <form action={setEntryAction}>
      <input type="hidden" name="deckId" value={props.deckId} />
      <input type="hidden" name="oracleId" value={line.oracleId} />
      <input type="hidden" name="board" value={line.board} />
      <input type="hidden" name="quantity" value={quantity} />
      <input type="hidden" name="q" value={props.q} />
      <button type="submit" aria-label={label} className={smallButton}>
        {text}
      </button>
    </form>
  );
  return (
    <span className="flex gap-1">
      {form(line.quantity - 1, `One fewer ${line.name}`, "−")}
      {form(line.quantity + 1, `One more ${line.name}`, "+")}
    </span>
  );
}

export default async function DeckPage(props: PageProps<"/decks/[id]">) {
  const actor = await requireActor();
  const { id } = await props.params;
  const deckId = Number(id);
  if (!Number.isSafeInteger(deckId) || deckId <= 0) notFound();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const q = typeof searchParams.q === "string" ? searchParams.q : "";

  const view = await deckView(db, actor.userId, deckId);
  if (view === null) notFound();
  const { deck, lines } = view;
  const owned = (oracleId: string) => lines.find((line) => line.oracleId === oracleId)?.owned ?? 0;
  const problems = deckProblems(deck, (oracleId) => view.rules[oracleId], owned);
  const shortBy = new Map(
    problems.flatMap((problem) =>
      problem.kind === "Short" ? [[problem.oracleId, problem.needed - problem.owned]] : [],
    ),
  );
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{deck.name}</h1>
          <p className="text-sm text-zinc-500">
            {FORMAT_LABELS[deck.format]} · {total} cards ·{" "}
            <Link href={`/decks/${deck.id}/export`} className="underline">
              Export
            </Link>{" "}
            ·{" "}
            <Link href={`/decks/${deck.id}/print`} className="underline">
              Print proxies
            </Link>{" "}
            ·{" "}
            <Link href="/decks" className="underline">
              All decks
            </Link>
          </p>
        </div>
      </header>
      {typeof searchParams.error === "string" && <Alert tone="error">{searchParams.error}</Alert>}
      {typeof searchParams.imported === "string" && (
        <Alert tone="success">{searchParams.imported}</Alert>
      )}

      <section aria-label="Problems" className="flex flex-col gap-2">
        {problems.length === 0 ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            {total === 0
              ? "Empty so far."
              : "Ready to play: you own everything, and it follows the format's rules."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-red-700 dark:text-red-400">
            {problems.map((problem, index) => (
              <li key={index}>• {problemText(problem)}</li>
            ))}
          </ul>
        )}
      </section>

      {total > 0 && <StatsPanel lines={lines} />}

      <div className="flex flex-col gap-8 lg:flex-row">
        <section className="flex flex-1 flex-col gap-6">
          {BOARDS.map((board) => {
            const onBoard = lines.filter((line) => line.board === board);
            if (onBoard.length === 0) return null;
            const groups = new Map<string, DeckLine[]>();
            for (const line of onBoard)
              groups.set(mainType(line.typeLine), [
                ...(groups.get(mainType(line.typeLine)) ?? []),
                line,
              ]);
            return (
              <div key={board} className="flex flex-col gap-2">
                <h2 className="font-medium">
                  {BOARD_TITLES[board]} ({onBoard.reduce((sum, line) => sum + line.quantity, 0)})
                </h2>
                {[...TYPE_ORDER, "Other"]
                  .filter((type) => groups.has(type))
                  .map((type) => (
                    <div key={type} className="flex flex-col gap-1">
                      <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                        {type}
                      </h3>
                      <ul className="flex flex-col gap-1 text-sm">
                        {(groups.get(type) ?? []).map((line) => {
                          const short = shortBy.get(line.oracleId) ?? 0;
                          return (
                            <li
                              key={`${line.board}/${line.oracleId}`}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span className="w-6 text-right tabular-nums">{line.quantity}</span>
                              <Link href={`/cards/${line.printingId}`} className="hover:underline">
                                {line.name}
                              </Link>
                              <span className="text-xs text-zinc-500">
                                {line.setCode} #{line.collectorNumber}
                                {line.isBasicLand ? "" : ` · own ${line.owned}`}
                                {line.otherDecks.length > 0 &&
                                  ` · also in ${line.otherDecks.join(", ")}`}
                              </span>
                              {short > 0 && (
                                <span className="rounded bg-red-100 px-1.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                                  short {short}
                                </span>
                              )}
                              <span className="flex-1" />
                              <EntryButtons deckId={deck.id} line={line} q={q} />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
              </div>
            );
          })}
        </section>

        <aside className="flex w-full flex-col gap-6 lg:w-80">
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Add from your collection</h2>
            <CardSearch
              deckId={deck.id}
              boards={
                deck.format === "commander" ? ["main", "commander", "side"] : ["main", "side"]
              }
              boardLabels={BOARD_TITLES}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Paste a list</h2>
            <form action={importListAction} className="flex flex-col gap-2">
              <input type="hidden" name="deckId" value={deck.id} />
              <textarea
                name="list"
                rows={6}
                aria-label="Deck list"
                placeholder={"4 Lightning Bolt\n1 Sol Ring (C21) 263\nSideboard\n2 Duress"}
                className={`${field} font-mono`}
              />
              <button type="submit" className={field}>
                Add these cards
              </button>
            </form>
            <p className="text-xs text-zinc-500">
              Cards you don&apos;t own are added too, and show as short.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Deck settings</h2>
            <form action={updateDeckAction} className="flex flex-col gap-2">
              <input type="hidden" name="deckId" value={deck.id} />
              <input
                name="name"
                defaultValue={deck.name}
                aria-label="Deck name"
                maxLength={60}
                className={field}
              />
              <select
                name="format"
                defaultValue={deck.format}
                aria-label="Format"
                className={field}
              >
                {FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {FORMAT_LABELS[format]}
                  </option>
                ))}
              </select>
              <button type="submit" className={field}>
                Save
              </button>
            </form>
            {/* A second click to confirm, so a slip doesn't delete a deck. */}
            <details className="text-sm">
              <summary className="cursor-pointer text-red-700 dark:text-red-400">
                Delete this deck…
              </summary>
              <form action={deleteDeckAction} className="mt-2">
                <input type="hidden" name="deckId" value={deck.id} />
                <button type="submit" className="rounded-md bg-red-700 px-3 py-1 text-white">
                  Yes, delete {deck.name}
                </button>
              </form>
            </details>
          </section>
        </aside>
      </div>
    </main>
  );
}
