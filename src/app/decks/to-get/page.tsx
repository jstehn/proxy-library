import Link from "next/link";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { WishForShortForm } from "../../wishlist/wish-forms";
import { Page } from "@/ui/page";
import { buttonClass } from "@/ui/button";

// Decks → Cards to get (design doc 21): every card your decks need beyond what you own. One copy
// serves every deck, so a card counts as many times as the deck that uses the most of it.

export default async function CardsToGetPage() {
  const { actor, reads } = await readPage();
  const toGet = await reads.decks.cardsToGet(actor);
  const copies = toGet.cards.reduce((sum, card) => sum + card.missing, 0);
  const unpriced = toGet.cards.filter((card) => card.priceCents === null).length;
  return (
    <Page>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Cards to get</h1>
        <p className="text-muted text-sm">
          What all your decks need that you don&apos;t own yet. A copy can be in every deck at once,
          so each card is counted for the deck that uses the most of it.{" "}
          <Link href="/decks" className="underline">
            Your decks
          </Link>
        </p>
      </header>
      {toGet.cards.length === 0 ? (
        <p className="text-success-text text-sm">Nothing: you own every card your decks use.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              {copies} {copies === 1 ? "copy" : "copies"} of {toGet.cards.length}{" "}
              {toGet.cards.length === 1 ? "card" : "cards"}, about{" "}
              {Cents.format(Cents.of(toGet.totalCents))} at the store&apos;s cheapest prices
              {unpriced > 0 && ` (${unpriced} not for sale)`}.
            </p>
            <Link
              href={`/singles/list?list=${encodeURIComponent(toGet.listText)}`}
              className={buttonClass()}
            >
              Buy them all
            </Link>
            <WishForShortForm label="Wish for them all" look="button" />
          </div>
          <table className="w-full text-sm">
            <thead className="text-muted text-left text-xs">
              <tr>
                <th className="py-1 font-medium">Card</th>
                <th className="py-1 text-right font-medium">To get</th>
                <th className="hidden py-1 font-medium sm:table-cell">For</th>
                <th className="py-1 text-right font-medium">Each</th>
              </tr>
            </thead>
            <tbody className="divide-border-subtle divide-y">
              {toGet.cards.map((card) => (
                <tr key={card.oracleId}>
                  <td className="py-1.5">
                    {card.name}
                    <span className="text-muted block text-xs sm:hidden">
                      {card.decks.map((deck) => deck.name).join(", ")}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {card.missing}
                    {card.owned > 0 && (
                      <span className="text-muted text-xs"> (own {card.owned})</span>
                    )}
                  </td>
                  <td className="hidden py-1.5 sm:table-cell">
                    {card.decks.map((deck, index) => (
                      <span key={deck.id}>
                        {index > 0 && ", "}
                        <Link href={`/decks/${deck.id}`} className="underline">
                          {deck.name}
                        </Link>
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {card.priceCents === null ? "—" : Cents.format(Cents.of(card.priceCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted text-xs">
            &quot;Buy them all&quot; opens Buy a list with these cards filled in, where you can
            check each line and choose printings before anything is bought. &quot;Wish for them
            all&quot; puts each card on your wishlist in any printing, at the cheapest price, and
            leaves alone a card you already wished for in a finish or printing you chose.
          </p>
        </>
      )}
    </Page>
  );
}
