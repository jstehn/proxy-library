import Link from "next/link";
import { notFound } from "next/navigation";
import { EXPORTERS, exportWithHeadings, type ExportLine } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";

// The deck as text (design doc 09): "4 Lightning Bolt (M11) 149", which Moxfield, Archidekt and
// Arena all read, or names only; and with the deck's own headings (design doc 34).

export default async function ExportPage(props: PageProps<"/decks/[id]/export">) {
  const { actor, reads } = await readPage();
  const deckId = Number((await props.params).id);
  const view = Number.isSafeInteger(deckId) ? await reads.decks.deckView(actor, deckId) : null;
  if (view === null) notFound();

  const lines: ExportLine[] = view.lines.map((line) => ({
    quantity: line.quantity,
    name: line.name,
    board: line.board,
    setCode: line.setCode,
    collectorNumber: line.collectorNumber,
    heading: line.heading,
  }));

  return (
    <Page width="3xl">
      <header>
        <h1 className="text-2xl font-semibold">Export: {view.deck.name}</h1>
        <p className="text-muted text-sm">
          Select the text and copy it.{" "}
          <Link href={`/decks/${view.deck.id}`} className="underline">
            Back to the deck
          </Link>
        </p>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">With printings (Moxfield, Archidekt)</h2>
        <textarea
          readOnly
          rows={16}
          aria-label="Deck list with printings"
          value={EXPORTERS.printings(lines)}
          className="border-line rounded-md border bg-transparent p-2 font-mono text-sm"
        />
      </section>
      {view.deck.headings.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">With headings (Archidekt, Moxfield)</h2>
          <textarea
            readOnly
            rows={16}
            aria-label="Deck list with headings"
            value={exportWithHeadings(lines, view.deck.headings)}
            className="border-line rounded-md border bg-transparent p-2 font-mono text-sm"
          />
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Names only (Arena, MTGO; no maybeboard)</h2>
        <textarea
          readOnly
          rows={10}
          aria-label="Deck list, names only"
          value={EXPORTERS.names(lines)}
          className="border-line rounded-md border bg-transparent p-2 font-mono text-sm"
        />
      </section>
    </Page>
  );
}
