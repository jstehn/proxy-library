import Link from "next/link";
import {
  CardFilters,
  filterValues,
  oneOf,
  pageNumber,
  Pagination,
  searchText,
} from "@/app/_components/card-filters";
import { printingCards } from "@/modules/catalog";
import {
  isRealCollectionShared,
  realCollectionPage,
  realCollectionSets,
  realProductsOf,
  sharedRealCollections,
} from "@/modules/real-collection";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { ManaStylesheet } from "@/ui/mana";
import { SECTION_VALUES, SECTIONS, SORT_VALUES, SORTS } from "../shared";
import { CollectionTabs } from "../tabs";
import {
  clearRealCollectionAction,
  removeRealProductAction,
  setRealSharingAction,
} from "./actions";
import { RealCardGrid } from "./card-grid";

// The Real tab (design doc 16, section 7): the cards you own physically, with the Game tab's
// search, filters, sections and totals. Nothing here touches money or the game (rule 1).

const button =
  "rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900";

export default async function RealCollectionPage(props: PageProps<"/collection/real">) {
  const actor = await requireActor();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const values = filterValues(searchParams);
  const page = pageNumber(searchParams);
  const finish = oneOf(values.finish, ["", "nonfoil", "foil", "etched"] as const);
  const isFiltered = ["q", "name", "set", "rarity", "color", "finish"].some((key) => key in values);
  const message = typeof searchParams.message === "string" ? searchParams.message : null;

  const [result, sets, products, isShared, shared] = await Promise.all([
    realCollectionPage(db, actor.userId, {
      search: searchText(values),
      setCode: values.set,
      rarity: values.rarity,
      color: values.color,
      finish: finish === "" ? undefined : finish,
      sections: oneOf(values.sections, SECTION_VALUES),
      sort: oneOf(values.sort, SORT_VALUES),
      page,
    }),
    realCollectionSets(db, actor.userId),
    realProductsOf(db, actor.userId),
    isRealCollectionShared(db, actor.userId),
    sharedRealCollections(db),
  ]);
  const others = shared.filter((player) => player.userId !== actor.userId);
  const cards = await printingCards(
    db,
    result.rows.map((row) => row.printingId),
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Collection</h1>
          <CollectionTabs current="real" />
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The cards you own for real: {result.totals.copies} cards ({result.totals.different}{" "}
          different) worth{" "}
          <strong className="tabular-nums">
            {Cents.format(Cents.of(result.totals.valueCents))}
          </strong>{" "}
          at market price{isFiltered && " (matching these filters)"}. They count in decks that use
          your real cards, and never in the game.
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/collection/real/import" className="font-medium underline">
            Import cards
          </Link>{" "}
          (a list, or a Moxfield or ManaBox file) · Export:{" "}
          <a href="/api/export/real?format=moxfield" className="underline">
            Moxfield CSV
          </a>{" "}
          ·{" "}
          <a href="/api/export/real?format=text" className="underline">
            text list
          </a>{" "}
          ·{" "}
          <a href="/api/export/real?format=full" className="underline">
            full CSV
          </a>
        </p>
      </header>
      {message !== null && <Alert tone="success">{message}</Alert>}

      <CardFilters
        action="/collection/real"
        values={values}
        sets={sets}
        sorts={SORTS}
        sections={SECTIONS}
        showFinish
        notes={result.notes}
      />

      {result.rows.length === 0 ? (
        <p className="text-muted text-sm">
          {isFiltered ? "No real cards match these filters." : "No real cards yet. "}
          {!isFiltered && (
            <>
              <Link href="/collection/real/import" className="underline">
                Import a list or a file
              </Link>
              , mark a product you own on its{" "}
              <Link href="/store" className="underline">
                store page
              </Link>
              , or add copies on any card&apos;s page.
            </>
          )}
        </p>
      ) : (
        <RealCardGrid rows={result.rows} cards={cards} />
      )}
      <Pagination
        action="/collection/real"
        values={values}
        page={page}
        pageCount={result.pageCount}
      />

      <div className="grid gap-8 border-t border-zinc-200 pt-6 md:grid-cols-2 dark:border-zinc-800">
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Products you own for real</h2>
          {products.length === 0 ? (
            <p className="text-muted text-sm">
              None yet. On a set&apos;s{" "}
              <Link href="/store" className="underline">
                store page
              </Link>
              , press &quot;I own this for real&quot; under a product to add its cards.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {products.map((product) => (
                <li key={product.id} className="flex flex-col gap-1 text-sm">
                  <span>
                    <Link href={`/store/${product.setCode}`} className="font-medium underline">
                      {product.name}
                    </Link>{" "}
                    <span className="text-muted">
                      added <LocalTime iso={product.addedAt} />
                    </span>
                  </span>
                  <details>
                    <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                      Remove…
                    </summary>
                    <form
                      action={removeRealProductAction}
                      className="mt-1 flex flex-wrap items-center gap-3"
                    >
                      <input type="hidden" name="realProductId" value={product.id} />
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" name="removeCards" defaultChecked />
                        Also remove its cards
                      </label>
                      <button type="submit" className={button}>
                        Remove {product.name}
                      </button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Settings</h2>
          <form action={setRealSharingAction} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="shared" value={isShared ? "off" : "on"} />
            <span className="text-zinc-600 dark:text-zinc-400">
              {isShared
                ? "Shared: other players can look at your real collection (not change it)."
                : "Private: only you can see your real collection."}
            </span>
            <button type="submit" className={button}>
              {isShared ? "Stop sharing" : "Let other players see my real collection"}
            </button>
          </form>
          {isShared && (
            <p className="text-sm">
              See{" "}
              <Link href={`/players/${actor.userId}/real`} className="underline">
                what other players see
              </Link>
            </p>
          )}
          {others.length > 0 && (
            <p className="text-sm">
              Other players&apos; real collections:{" "}
              {others.map((player, index) => (
                <span key={player.userId}>
                  {index > 0 && ", "}
                  <Link href={`/players/${player.userId}/real`} className="underline">
                    {player.displayName}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {/* A second click to confirm, so a slip doesn't empty the collection. */}
          <details className="text-sm">
            <summary className="cursor-pointer text-red-700 dark:text-red-400">
              Clear real collection…
            </summary>
            <form action={clearRealCollectionAction} className="mt-2 flex flex-col gap-2">
              <p className="text-zinc-600 dark:text-zinc-400">
                Removes every real card. Your products list, decks and game collection stay.
              </p>
              <button
                type="submit"
                className="self-start rounded-md bg-red-700 px-3 py-1 text-white"
              >
                Yes, remove every real card
              </button>
            </form>
          </details>
        </section>
      </div>
    </main>
  );
}
