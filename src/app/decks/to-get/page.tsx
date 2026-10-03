import Link from "next/link";
import { cardsToGetFor } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";

// Decks → Cards to get (design doc 21): every card your decks need beyond what you own. One copy
// serves every deck, so a card counts as many times as the deck that uses the most of it.

export default async function CardsToGetPage() {
  const actor = await requireActor();
  const toGet = await cardsToGetFor(getContainer().db, actor.userId);
  const copies = toGet.cards.reduce((sum, card) => sum + card.missing, 0);
  const unpriced = toGet.cards.filter((card) => card.priceCents === null).length;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Cards to get</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          What all your decks need that you don&apos;t own yet. A copy can be in every deck at once,
          so each card is counted for the deck that uses the most of it.{" "}
          <Link href="/decks" className="underline">
            Your decks
          </Link>
        </p>
      </header>
      {toGet.cards.length === 0 ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          Nothing: you own every card your decks use.
        </p>
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
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Buy them all
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Card</th>
                <th className="py-1 text-right font-medium">To get</th>
                <th className="hidden py-1 font-medium sm:table-cell">For</th>
                <th className="py-1 text-right font-medium">Each</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {toGet.cards.map((card) => (
                <tr key={card.oracleId}>
                  <td className="py-1.5">
                    {card.name}
                    <span className="block text-xs text-zinc-500 sm:hidden">
                      {card.decks.map((deck) => deck.name).join(", ")}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {card.missing}
                    {card.owned > 0 && (
                      <span className="text-xs text-zinc-500"> (own {card.owned})</span>
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
          <p className="text-xs text-zinc-500">
            &quot;Buy them all&quot; opens Buy a list with these cards filled in, where you can
            check each line and choose printings before anything is bought.
          </p>
        </>
      )}
    </main>
  );
}
