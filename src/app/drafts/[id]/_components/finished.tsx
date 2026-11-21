import Link from "next/link";
import type { PrintingCard } from "@/modules/catalog";
import type { DraftSeen, DraftView } from "@/modules/drafts";
import { buttonClass } from "@/ui/button";
import { SubmitButton } from "@/ui/form";
import { CardTile } from "@/app/_components/card-tile";
import { makeDraftDeckAction } from "../../actions";
import { basicCount, Picks, refKey } from "./pool-view";

export function Finished(props: {
  view: DraftView;
  seen: DraftSeen;
  printings: ReadonlyMap<string, PrintingCard>;
}) {
  const { view, printings } = props;
  const you = view.you;
  const seen = props.seen.you;
  return (
    <div className="flex flex-col gap-6">
      {you === null || seen === null ? (
        <p className="text-muted text-sm">
          {view.seats.map((seat) => seat.name).join(", ")} drafted this one.
        </p>
      ) : (
        <>
          <section className="border-border-subtle flex flex-wrap items-center gap-3 rounded-lg border p-4">
            <p className="text-sm">
              Your {seen.pile.length} cards are in your collection
              {you.basicsReceived.length > 0 &&
                `, with ${basicCount(you)} basic lands dealt from the packs`}
              {you.botPicks > 0 && `, and the ${you.botPicks} cards your bots picked`}.
              {you.deckId !== null
                ? " Your draft deck has a suggested 40-card build to start from."
                : ""}
            </p>
            {you.deckId !== null ? (
              <Link href={`/decks/${you.deckId}`} className={buttonClass()}>
                Open your deck
              </Link>
            ) : (
              <form action={makeDraftDeckAction}>
                <input type="hidden" name="draftId" value={view.id} />
                <SubmitButton>Make a deck from this draft</SubmitButton>
              </form>
            )}
          </section>
          <Picks cards={seen.pool} printings={printings} />
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Everything you drafted, in order</h2>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
              {seen.pile.map((card) => {
                const printing = printings.get(card.printingId);
                const state = card.pick?.state;
                const where =
                  state === "removedFaceDown" || state === "removedFaceUp"
                    ? " · removed from the draft"
                    : state === "returned"
                      ? " · put back into a pack"
                      : "";
                return printing === undefined ? null : (
                  <CardTile
                    key={refKey(card)}
                    printing={printing}
                    isFoil={card.finish !== "nonfoil"}
                    href={`/cards/${printing.id}`}
                    priceLine={`Pick ${card.pick?.pickNumber ?? ""}${card.pick?.auto ? " (auto)" : ""}${where}`}
                  />
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
