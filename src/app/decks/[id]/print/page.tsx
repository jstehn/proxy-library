import Link from "next/link";
import { notFound } from "next/navigation";
import { readPage } from "@/server/page-instance";
import { ProxyForm } from "./proxy-form";
import { Page } from "@/ui/page";

// Proxy PDFs (design doc 14, section 3): choose the options, then download the PDF. It prints at
// exactly the real card size from any PDF viewer (choose "actual size", not "fit to page").

export default async function PrintPage(props: PageProps<"/decks/[id]/print">) {
  const { actor, capabilities } = await readPage();
  const deck = await capabilities.proxyDeck(actor.userId, Number((await props.params).id));
  if (deck === null) notFound();

  return (
    <Page spacing="tight">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Proxies: {deck.view.deck.name}</h1>
        <p className="text-muted text-sm">
          A PDF of real-size cards (2.5 × 3.5 inches) with cutting guides.{" "}
          <Link href={`/decks/${deck.view.deck.id}`} className="underline">
            Back to the deck
          </Link>
        </p>
      </header>
      <ProxyForm deckId={deck.view.deck.id} lines={deck.lines} tokens={deck.tokens} />
    </Page>
  );
}
