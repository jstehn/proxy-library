import Link from "next/link";
import { notFound } from "next/navigation";
import { deckView } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

// Proxy sheet (design doc 09): every card in the deck at real size, 63 × 88 mm, three by three on a
// page. Print from the browser at 100% scale ("actual size"). The large images keep text sharp.

export default async function PrintPage(props: PageProps<"/decks/[id]/print">) {
  const actor = await requireActor();
  const deckId = Number((await props.params).id);
  const view = Number.isSafeInteger(deckId)
    ? await deckView(getContainer().db, actor.userId, deckId)
    : null;
  if (view === null) notFound();

  // One image per copy: 4 Lightning Bolts print 4 times.
  const copies = view.lines.flatMap((line) => Array.from({ length: line.quantity }, () => line));

  return (
    <main className="mx-auto flex w-full flex-col items-center gap-4 px-4 py-8 print:p-0">
      <header className="flex flex-col items-center gap-1 text-center print:hidden">
        <h1 className="text-2xl font-semibold">Proxies: {view.deck.name}</h1>
        <p className="text-sm text-zinc-500">
          {copies.length} cards on {Math.ceil(copies.length / 9)} pages. Print at 100% scale
          (&quot;actual size&quot;), with no margins added by the browser.{" "}
          <Link href={`/decks/${view.deck.id}`} className="underline">
            Back to the deck
          </Link>
        </p>
      </header>
      <div className="grid grid-cols-[repeat(3,63mm)] gap-[1mm] print:gap-0">
        {copies.map((line, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={`/api/images/${line.printingId}/large/front`}
            alt={line.name}
            className="h-[88mm] w-[63mm] break-inside-avoid bg-zinc-100 object-cover"
          />
        ))}
      </div>
    </main>
  );
}
