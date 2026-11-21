import type { PrintingCard } from "@/modules/catalog";
import type { UserId } from "@/shared/kernel";
import type { DeckView } from "../../domain/deck-view";
import type { ProxyLine } from "../domain/proxy-sheet";
import type { TokenLine, TokenMaker } from "../domain/token-proxies";

// A deck as the proxy sheet needs it (design doc 25), for the print page and the PDF download.

/** A deck's proxy sheet: the deck, its lines and the tokens its cards make. */
export type ProxyDeck = Readonly<{ view: DeckView; lines: ProxyLine[]; tokens: TokenLine[] }>;

export type ProxyDeckReaders = Readonly<{
  deckView: (userId: UserId, deckId: number) => Promise<DeckView | null>;
  printingCards: (printingIds: readonly string[]) => Promise<ReadonlyMap<string, PrintingCard>>;
  tokenLines: (deckId: number, makers: readonly TokenMaker[]) => Promise<TokenLine[]>;
}>;

/** What a proxy prints for a printing missing from the catalog: the card's name alone. */
function nameOnlyFace(name: string) {
  return {
    name,
    manaCost: null,
    typeLine: "",
    text: "",
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
  };
}

export function makeProxyDeck(readers: ProxyDeckReaders) {
  const { deckView, printingCards, tokenLines } = readers;

  async function proxyDeck(userId: UserId, deckId: number): Promise<ProxyDeck | null> {
    const view = Number.isSafeInteger(deckId) ? await deckView(userId, deckId) : null;
    if (view === null) return null;
    const cards = await printingCards(view.lines.map((line) => line.printingId));
    const lines = view.lines.map((line): ProxyLine => {
      const card = cards.get(line.printingId);
      return {
        oracleId: line.oracleId,
        printingId: line.printingId,
        name: line.name,
        quantity: line.quantity,
        // Counted only when the deck uses real cards (design doc 16).
        ownedReal: line.ownedReal,
        board: line.board,
        isBasicLand: line.isBasicLand,
        hasBack: card?.hasBackImage ?? false,
        isFoil: line.finish !== "nonfoil", // foil and etched both print on foil paper
        // What a playtest proxy prints (design doc 22). A printing missing from the catalog
        // still gets a card with its name, rather than stopping the sheet.
        printed: {
          faces: card?.faces ?? [nameOnlyFace(line.name)],
          doubleFaced: card?.hasBackImage ?? false,
          colors: card?.colors ?? [],
          producedMana: card?.producedMana ?? [],
          setCode: card?.setCode ?? "",
          collectorNumber: card?.collectorNumber ?? "",
          artist: card?.artist ?? null,
          isToken: false,
        },
      };
    });
    const tokens = await tokenLines(
      view.deck.id,
      view.lines.map((line) => ({
        oracleId: line.oracleId,
        printingId: line.printingId,
        name: line.name,
        board: line.board,
      })),
    );
    return { view, lines, tokens };
  }
  return proxyDeck;
}
