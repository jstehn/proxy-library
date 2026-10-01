import Link from "next/link";
import { deckProblems, deckView, shortList } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { ManaStylesheet } from "@/ui/mana";
import { ListBuyer } from "./list-buyer";

// Singles → Buy a list (design doc 15, section 3). From a deck ("?deck=12"), the list starts as
// the cards that deck is short of.

export default async function BuyListPage(props: PageProps<"/singles/list">) {
  const actor = await requireActor();
  const { db, wallet } = getContainer();
  const searchParams = await props.searchParams;
  const deckId = Number(typeof searchParams.deck === "string" ? searchParams.deck : NaN);

  let startingText = "";
  let deckName: string | null = null;
  if (Number.isSafeInteger(deckId) && deckId > 0) {
    const view = await deckView(db, actor.userId, deckId);
    if (view !== null) {
      deckName = view.deck.name;
      const owned = (oracleId: string) =>
        view.lines.find((line) => line.oracleId === oracleId)?.owned ?? 0;
      startingText = shortList(
        deckProblems(view.deck, (oracleId) => view.rules[oracleId], owned),
        view.lines,
      );
    }
  }
  const balance = await wallet.refreshWallet(actor.userId);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Buy a list of cards</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Paste a list, one card per line, as deck sites write them: <code>4 Lightning Bolt</code>,{" "}
          <code>1 Sol Ring (C21) 263</code>, and <code>*F*</code> for foil. Check what each line
          would buy, then buy it all at once.{" "}
          <Link href="/singles" className="underline">
            Back to singles
          </Link>
        </p>
        {deckName !== null && (
          <p className="text-sm">
            {startingText === ""
              ? `${deckName} isn't short of anything.`
              : `Filled in with the cards ${deckName} is short of.`}
          </p>
        )}
      </header>
      <ListBuyer startingText={startingText} balanceCents={balance} />
    </main>
  );
}
