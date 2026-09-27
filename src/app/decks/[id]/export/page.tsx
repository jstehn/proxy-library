import Link from "next/link";
import { notFound } from "next/navigation";
import { deckView, EXPORTERS, type ExportLine } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

// The deck as text (design doc 09): "4 Lightning Bolt (M11) 149", which Moxfield, Archidekt and
// Arena all read, or names only.

export default async function ExportPage(props: PageProps<"/decks/[id]/export">) {
  const actor = await requireActor();
  const deckId = Number((await props.params).id);
  const view = Number.isSafeInteger(deckId)
    ? await deckView(getContainer().db, actor.userId, deckId)
    : null;
  if (view === null) notFound();

  const lines: ExportLine[] = view.lines.map((line) => ({
    quantity: line.quantity,
    name: line.name,
    board: line.board,
    setCode: line.setCode,
    collectorNumber: line.collectorNumber,
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold">Export: {view.deck.name}</h1>
        <p className="text-sm text-zinc-500">
          Select the text and copy it.{" "}
          <Link href={`/decks/${view.deck.id}`} className="underline">
            Back to the deck
          </Link>
        </p>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">With printings (Moxfield, Archidekt, Arena)</h2>
        <textarea
          readOnly
          rows={16}
          aria-label="Deck list with printings"
          value={EXPORTERS.printings(lines)}
          className="rounded-md border border-zinc-300 bg-transparent p-2 font-mono text-sm dark:border-zinc-700"
        />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Names only</h2>
        <textarea
          readOnly
          rows={10}
          aria-label="Deck list, names only"
          value={EXPORTERS.names(lines)}
          className="rounded-md border border-zinc-300 bg-transparent p-2 font-mono text-sm dark:border-zinc-700"
        />
      </section>
    </main>
  );
}
