import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/session";
import { ProxyForm } from "./proxy-form";
import { proxyDeck } from "./proxy-lines";

// Proxy PDFs (design doc 14, section 3): choose the options, then download the PDF. It prints at
// exactly the real card size from any PDF viewer (choose "actual size", not "fit to page").

export default async function PrintPage(props: PageProps<"/decks/[id]/print">) {
  const actor = await requireActor();
  const deck = await proxyDeck(actor.userId, Number((await props.params).id));
  if (deck === null) notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Proxies: {deck.view.deck.name}</h1>
        <p className="text-sm text-zinc-500">
          A PDF of real-size cards (2.5 × 3.5 inches) with cutting guides.{" "}
          <Link href={`/decks/${deck.view.deck.id}`} className="underline">
            Back to the deck
          </Link>
        </p>
      </header>
      <ProxyForm deckId={deck.view.deck.id} lines={deck.lines} />
    </main>
  );
}
