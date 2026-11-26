import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { EXPORTERS } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { Alert } from "@/ui/form";
import { ManaStylesheet } from "@/ui/mtg/mana";
import { copyPublicDeckAction } from "../../decks/actions";
import { SharedDeckView } from "../../decks/[id]/shared-view";
import { FORMAT_LABELS } from "../../decks/labels";
import { Button } from "@/ui/button";
import { Page } from "@/ui/page";

const loadPublicDeck = cache(async (token: string) => {
  const { reads } = await readPage({ allowVisitors: true });
  return reads.decks.publicDeck(token);
});

export async function generateMetadata(props: PageProps<"/d/[token]">): Promise<Metadata> {
  const { token } = await props.params;
  const found = await loadPublicDeck(token);
  if (found === null) return { title: "Deck not found — Proxy Library" };
  return {
    title: `${found.view.deck.name} — Proxy Library`,
    description: `${FORMAT_LABELS[found.view.deck.format]} deck shared by ${found.ownerName}.`,
  };
}

export default async function PublicDeckPage(props: PageProps<"/d/[token]">) {
  const { token } = await props.params;
  const searchParams = await props.searchParams;
  const [{ actor, capabilities, reads }, found] = await Promise.all([
    readPage({ allowVisitors: true }),
    loadPublicDeck(token),
  ]);
  if (found === null) notFound();

  const { view, ownerName } = found;
  const { deck } = view;
  const [cards, tokens] = await Promise.all([
    capabilities.printingDetails(view.lines.map((line) => line.printingId)),
    reads.decks.publicDeckTokens(
      token,
      view.lines.map((line) => ({
        oracleId: line.oracleId,
        printingId: line.printingId,
        name: line.name,
        board: line.board,
      })),
    ),
  ]);

  return (
    <Page width="7xl" spacing="tight">
      <ManaStylesheet />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{deck.name}</h1>
          <p className="text-muted text-sm">
            {FORMAT_LABELS[deck.format]} · shared by {ownerName}
          </p>
        </div>
        {actor !== null && (
          <form action={copyPublicDeckAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Copy to my decks</Button>
          </form>
        )}
      </header>
      {typeof searchParams.error === "string" && <Alert tone="error">{searchParams.error}</Alert>}
      <SharedDeckView
        lines={view.lines}
        rules={view.rules}
        cards={Object.fromEntries(cards)}
        format={deck.format}
        targetBracket={deck.targetBracket}
        seed={capabilities.site.newSeed()}
        ownerName={ownerName}
        listText={EXPORTERS.names(view.lines)}
        grouping={deck.grouping}
        headings={deck.headings}
        tokens={tokens}
      />
    </Page>
  );
}
