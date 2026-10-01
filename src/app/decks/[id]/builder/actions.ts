"use server";
import { z } from "zod";
import { PrintingId, printingCards, type PrintingCard } from "@/modules/catalog";
import {
  BOARDS,
  BROWSE_SORTS,
  browseCollection,
  deckBrowseContext,
  DeckId,
  deckProblems,
  deckView,
  type BrowsePage,
  type DeckLine,
} from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { problemText } from "../../labels";

// The deck builder's server side (design doc 14). The browser holds the deck in memory for
// instant statistics; every change goes through the decks module (which re-checks it), and the
// fresh deck comes back.

const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);

const BrowseInput = z.object({
  deckId: z.number().int().positive(),
  search: z.string().max(400),
  colors: z.array(ColorSchema).max(5).nullable(),
  includeColorless: z.boolean(),
  onlyLegal: z.boolean(),
  sort: z.enum(BROWSE_SORTS),
  page: z.number().int().min(1).max(1000),
});

/** One page of your collection, filtered and sorted for this deck. */
export async function browseAction(input: z.input<typeof BrowseInput>): Promise<BrowsePage | null> {
  const actor = await requireActor();
  const parsed = BrowseInput.safeParse(input);
  if (!parsed.success) return null;
  return browseCollection(getContainer().db, actor.userId, parsed.data);
}

/** A card's details for the selected-card panel and previews. */
export async function cardDetailAction(printingId: string): Promise<PrintingCard | null> {
  await requireActor();
  if (!/^[0-9a-f-]{36}$/.test(printingId)) return null;
  const cards = await printingCards(getContainer().db, [printingId]);
  return cards.get(printingId) ?? null;
}

/** The deck as the builder shows it, and the problems with it in words. */
export type BuilderDeck = Readonly<{
  lines: DeckLine[];
  /** Each problem in words, with the card's name when it's about one card. */
  problems: Array<{ text: string; name: string | null }>;
  /** The commanders' combined color identity (null without a commander or outside Commander). */
  commanderColors: Array<"W" | "U" | "B" | "R" | "G"> | null;
  /** Card details for every line, for name previews. */
  cards: Record<string, PrintingCard>;
}>;

/** Loads the deck for the builder. */
export async function loadBuilderDeck(deckId: number): Promise<BuilderDeck | null> {
  const actor = await requireActor();
  const { db } = getContainer();
  const [view, context] = await Promise.all([
    deckView(db, actor.userId, deckId),
    deckBrowseContext(db, actor.userId, deckId),
  ]);
  if (view === null || context === null) return null;
  const problems = deckProblems(
    view.deck,
    (oracleId) => view.rules[oracleId],
    (oracleId) => view.lines.find((line) => line.oracleId === oracleId)?.owned ?? 0,
  );
  const cards = await printingCards(
    db,
    view.lines.map((line) => line.printingId),
  );
  return {
    lines: view.lines,
    problems: problems.map((problem) => ({
      text: problemText(problem),
      name: "name" in problem ? problem.name : null,
    })),
    commanderColors: context.commanderColors,
    cards: Object.fromEntries(cards),
  };
}

const QuantityInput = z.object({
  deckId: z.number().int().positive(),
  oracleId: z.string().min(1),
  printingId: z.string().min(1).optional(),
  board: z.enum(BOARDS),
  quantity: z.number().int().min(0).max(99),
});

export type QuantityResult = { ok: true; deck: BuilderDeck } | { ok: false; message: string };

/** Sets how many of a card are on one board (0 removes it), and returns the fresh deck. */
export async function setQuantityAction(
  input: z.input<typeof QuantityInput>,
): Promise<QuantityResult> {
  const actor = await requireActor();
  const parsed = QuantityInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const { deckId, oracleId, printingId, board, quantity } = parsed.data;
  const result = await getContainer().decks.setEntry(actor, {
    deckId: DeckId.of(deckId),
    oracleId,
    board,
    quantity,
    printingId: printingId ? PrintingId.of(printingId) : undefined,
  });
  if (!result.ok) {
    const messages: Record<string, string> = {
      DeckNotFound: "That deck isn't yours.",
      CardNotFound: "That card isn't in the catalog.",
      QuantityInvalid: "That's not a quantity the deck allows (0 to 99).",
    };
    return { ok: false, message: messages[result.error.kind] ?? "Couldn't change the deck." };
  }
  const deck = await loadBuilderDeck(deckId);
  if (deck === null) return { ok: false, message: "That deck isn't yours." };
  return { ok: true, deck };
}
