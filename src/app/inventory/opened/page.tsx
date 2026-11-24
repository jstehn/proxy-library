import { packKey, variantFor, type PrintingCard } from "@/modules/catalog";
import { type OpeningView } from "@/modules/inventory";
import type { Capabilities } from "@/server/composition/capabilities";
import type { Reads } from "@/server/composition/reads";
import { readPage } from "@/server/page-instance";
import { ManaStylesheet } from "@/ui/mtg/mana";
import type { OpenerPack } from "./_components/machine";
import { OpenedResults } from "./_components/opened-results";
import type { SerializedOpening } from "./_components/opened-summary";
import { PackOpener } from "./_components/pack-opener";
import { KeyruneStylesheet } from "@/ui/mtg/set-symbol";
import { productLabel } from "../../store/labels";
import { Page } from "@/ui/page";

// What one or more openings produced: packs in reveal order, decks, and what boxes unpacked into.
// (Phase 8 turns a pack into an animated reveal.)

const MAX_SHOWN = 100;

export default async function OpenedPage(props: PageProps<"/inventory/opened">) {
  const { actor, capabilities, reads } = await readPage();
  const searchParams = await props.searchParams;
  const raw = searchParams.items;
  const animate = searchParams.animate === "1";
  const newDecks = typeof searchParams.decks === "string" ? searchParams.decks : null;
  const ids = (typeof raw === "string" ? raw.split(",") : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, MAX_SHOWN);

  const openings = (
    await Promise.all(ids.map((id) => reads.inventory.openingView(actor, id)))
  ).filter((opening): opening is OpeningView => opening !== null);

  const allPrintingIds = openings.flatMap((opening) =>
    opening.cards.map((card) => card.printingId),
  );
  const packs = openings.filter((opening) => opening.contentKind === "pack");

  const [cards, themes, owned] = await Promise.all([
    capabilities.printingDetails(allPrintingIds),
    reads.packs.themes(packs),
    reads.collection.ownedCounts(actor, allPrintingIds),
  ]);

  const serializedOpenings: SerializedOpening[] = openings.map((opening) => ({
    itemId: opening.itemId,
    name: opening.name,
    contentKind: opening.contentKind,
    theme: themes.get(opening.itemId) ?? null,
    children: opening.children,
    extras: opening.extras,
    cards: opening.cards.map((card) => ({
      printingId: card.printingId,
      finish: card.finish,
      quantity: card.quantity,
    })),
  }));

  const cardsById: Record<string, PrintingCard> = Object.fromEntries(cards);
  const ownedByKey: Record<string, number> = Object.fromEntries(owned);

  const results = (
    <OpenedResults
      openings={serializedOpenings}
      cardsById={cardsById}
      ownedByKey={ownedByKey}
      packCount={packs.length}
      newDecks={newDecks}
    />
  );

  return (
    <Page width="6xl" spacing="wide">
      <KeyruneStylesheet />
      <ManaStylesheet />
      {animate && packs.length > 0 ? (
        <PackOpener packs={await openerPacks(capabilities, reads, packs, cards, themes)}>
          {results}
        </PackOpener>
      ) : (
        results
      )}
    </Page>
  );
}

/**
 * The packs as the opener needs them. The art on the pack is the set's featured card, never a
 * card from inside it, so the front of the pack gives nothing away.
 */
async function openerPacks(
  capabilities: Capabilities,
  reads: Reads,
  packs: readonly OpeningView[],
  cards: Map<string, PrintingCard>,
  themes: ReadonlyMap<number, string>,
): Promise<OpenerPack[]> {
  const setCodes = [...new Set(packs.flatMap((pack) => (pack.setCode ? [pack.setCode] : [])))];
  const sets = new Map(
    await Promise.all(
      setCodes.map(async (code) => {
        const [set, page] = await Promise.all([
          reads.catalog.findSet(code),
          reads.store.page(code),
        ]);
        return [code, { set, featured: page?.set.featured ?? null }] as const;
      }),
    ),
  );

  const photos = await reads.catalog.packPhotos(
    packs.flatMap((pack) =>
      pack.setCode && pack.boosterType
        ? [{ setCode: pack.setCode, boosterType: pack.boosterType }]
        : [],
    ),
  );

  return packs.map((pack) => {
    const info = pack.setCode === null ? undefined : sets.get(pack.setCode);
    const setName = info?.set?.name ?? pack.setCode ?? "";
    const photoIds =
      (pack.setCode && pack.boosterType && photos.get(packKey(pack.setCode, pack.boosterType))) ||
      [];
    return {
      itemId: pack.itemId,
      name: pack.name,
      setCode: pack.setCode ?? "",
      setName,
      keyruneCode: info?.set?.keyruneCode ?? "",
      label: productLabel(pack.name, setName),
      featuredPrintingId: info?.featured?.printingId ?? null,
      photoIds,
      photoVariant: variantFor(pack.itemId, photoIds.length),
      theme: themes.get(pack.itemId) ?? null,
      cards: pack.cards.map((card) => {
        const printing = cards.get(card.printingId);
        return {
          printingId: card.printingId,
          name: printing?.name ?? "Unknown card",
          rarity: printing?.rarity ?? "common",
          finish: card.finish,
          priceCents: printing?.prices[card.finish] ?? null,
          hasImage: printing?.hasImage ?? false,
          variantLabel: printing?.variantLabel ?? "",
        };
      }),
    };
  });
}
