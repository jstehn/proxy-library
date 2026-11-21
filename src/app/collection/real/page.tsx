import Link from "next/link";
import { CardFilters, Pagination } from "@/app/_components/card-filters";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { ManaStylesheet } from "@/ui/mana";
import { SECTIONS, SORTS } from "@/app/collection/options";
import { CollectionCardGrid, ExportLinks } from "../card-grid";
import { readCollectionQuery } from "../collection-query";
import { CollectionTabs } from "../tabs";
import {
  clearRealCollectionAction,
  removeRealProductAction,
  setRealSharingAction,
} from "./actions";
import { Button } from "@/ui/button";
import { Page } from "@/ui/page";

// The Real tab (design doc 16, section 7): the cards you own physically, with the Game tab's
// search, filters, sections and totals. Nothing here touches money or the game (rule 1).

export default async function RealCollectionPage(props: PageProps<"/collection/real">) {
  const { actor, capabilities, reads } = await readPage();
  const searchParams = await props.searchParams;
  const { values, page, filter, isFiltered } = readCollectionQuery(searchParams);
  const message = typeof searchParams.message === "string" ? searchParams.message : null;

  const [result, sets, products, isShared, shared] = await Promise.all([
    reads.realCollection.page(actor, actor.userId, filter),
    reads.realCollection.sets(actor, actor.userId),
    reads.realCollection.productsOf(actor, actor.userId),
    reads.realCollection.isShared(actor),
    reads.realCollection.shared(),
  ]);
  const others = shared.filter((player) => player.userId !== actor.userId);
  const cards = await capabilities.printingDetails(result.rows.map((row) => row.printingId));

  return (
    <Page width="6xl">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Collection</h1>
          <CollectionTabs current="real" />
        </div>
        <p className="text-muted text-sm">
          The cards you own for real: {result.totals.copies} cards ({result.totals.different}{" "}
          different) worth{" "}
          <strong className="tabular-nums">
            {Cents.format(Cents.of(result.totals.valueCents))}
          </strong>{" "}
          at market price{isFiltered && " (matching these filters)"}. They count in decks that use
          your real cards, and never in the game.
        </p>
        <p className="text-muted text-sm">
          <Link href="/collection/real/import" className="font-medium underline">
            Import cards
          </Link>{" "}
          (a list, or a Moxfield or ManaBox file) · Export: <ExportLinks path="/api/export/real" />
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
        <CollectionCardGrid rows={result.rows} cards={cards} />
      )}
      <Pagination
        action="/collection/real"
        values={values}
        page={page}
        pageCount={result.pageCount}
      />

      <div className="border-border-subtle grid gap-8 border-t pt-6 md:grid-cols-2">
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
                    <summary className="text-muted cursor-pointer">Remove…</summary>
                    <form
                      action={removeRealProductAction}
                      className="mt-1 flex flex-wrap items-center gap-3"
                    >
                      <input type="hidden" name="realProductId" value={product.id} />
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" name="removeCards" defaultChecked />
                        Also remove its cards
                      </label>
                      <Button type="submit" variant="secondary" size="sm">
                        Remove {product.name}
                      </Button>
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
            <span className="text-muted">
              {isShared
                ? "Shared: other players can look at your real collection (not change it)."
                : "Private: only you can see your real collection."}
            </span>
            <Button type="submit" variant="secondary" size="sm">
              {isShared ? "Stop sharing" : "Let other players see my real collection"}
            </Button>
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
            <summary className="text-danger-text cursor-pointer">Clear real collection…</summary>
            <form action={clearRealCollectionAction} className="mt-2 flex flex-col gap-2">
              <p className="text-muted">
                Removes every real card. Your products list, decks and game collection stay.
              </p>
              <Button type="submit" variant="danger" size="sm" className="self-start">
                Yes, remove every real card
              </Button>
            </form>
          </details>
        </section>
      </div>
    </Page>
  );
}
