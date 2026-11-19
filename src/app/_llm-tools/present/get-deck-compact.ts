import {
  isKeyCard,
  type DeckLine,
  type DeckOverview,
  type DeckProblem,
  type DeckView,
} from "@/modules/decks";
import { problemText } from "@/app/decks/labels";
import { MAX_TOOL_RESPONSE_BYTES } from "../cap-response";
import { groupCompactLines, pageCompactGroups } from "../compact-deck";
import { money } from "../tool";

import { bracketView, type PresentInput } from "./get-deck-input";

// What get_deck says (design doc 61, section 5a); these functions only reshape what the
// capabilities answered, and never query.

/** Room kept under the response cap for the `next` cursor and JSON framing. */
const PAGE_MARGIN_BYTES = 800;

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * get_deck's compact view (design doc 61, section 5a): the deck header, stats and problems on the
 * first page, then card lines grouped by heading, paged by whole groups under the response cap.
 */
export function compactDeckPayload(
  overview: DeckOverview,
  input: PresentInput,
  fullPayload: Record<string, unknown>,
): Record<string, unknown> {
  const { view } = overview;
  const profile = overview.profile?.profile ?? null;
  const requestedBoards = input.boards && input.boards.length > 0 ? input.boards : null;
  const shownBoards: readonly DeckLine["board"][] = requestedBoards ?? [
    "commander",
    "main",
    "side",
  ];
  const shownLines = view.lines.filter((line) => shownBoards.includes(line.board));
  const groups = groupCompactLines(
    shownLines.map((line) => ({
      ...line,
      pinned: isKeyCard(line.name, profile, line.pinned === true),
      ...(line.board === "side" || line.board === "maybe"
        ? { heading: line.board === "side" ? "Sideboard" : "Maybeboard" }
        : {}),
    })),
    {
      byHeading: view.deck.grouping === "custom",
      headings: [...view.deck.headings, "Sideboard", "Maybeboard"],
      includeText: input.includeText,
    },
  );
  const cursor = input.cursor ?? 0;
  if (cursor > 0) {
    const page = pageCompactGroups(
      groups,
      MAX_TOOL_RESPONSE_BYTES - PAGE_MARGIN_BYTES - 200,
      cursor,
    );
    return {
      deck: { id: view.deck.id, name: view.deck.name },
      cards: page.cards,
      ...(page.next !== undefined ? { next: page.next } : {}),
    };
  }

  const stats = fullPayload.stats as Record<string, unknown>;
  const bracket = fullPayload.bracket as ReturnType<typeof bracketView>;
  const problems = overview.problems;
  const missingLines = shortLinesOf(view, problems);
  const missingCopies = missingLines.reduce((sum, entry) => sum + entry.missing, 0);
  const header: Record<string, unknown> = {
    deck: {
      id: view.deck.id,
      name: view.deck.name,
      format: view.deck.format,
      ...(view.deck.format === "commander"
        ? {
            commander: view.lines
              .filter((line) => line.board === "commander")
              .map((line) => line.name),
          }
        : {}),
      cards: stats.cardCount,
      ...(stats.sideboardCount ? { sideboard: stats.sideboardCount } : {}),
      lands: stats.lands,
      averageManaValue: stats.averageManaValue,
      ...(bracket !== null
        ? {
            bracket: {
              target: bracket.target,
              estimate: bracket.summary,
              gameChangers: bracket.gameChangers,
              ...(bracket.overTarget !== null ? { overTarget: bracket.overTarget } : {}),
              ...(bracket.findings.length > 0
                ? { findings: bracket.findings.map((finding) => finding.text) }
                : {}),
            },
          }
        : {}),
    },
    ...(fullPayload.profileSummary !== undefined
      ? { profileSummary: fullPayload.profileSummary }
      : {}),
    fingerprint: fullPayload.fingerprint,
  };
  const maybeNames =
    requestedBoards === null
      ? view.lines.filter((line) => line.board === "maybe").map((line) => line.name)
      : [];
  const otherProblems = problems.filter((problem) => problem.kind !== "Short").map(problemText);
  const footer: Record<string, unknown> = {
    ...(maybeNames.length > 0 ? { maybe: maybeNames } : {}),
    stats: {
      curve: stats.curve,
      types: stats.types,
      pips: stats.pips,
      sources: stats.sources,
      otherManaSources: stats.otherManaSources,
      roles: stats.roles,
    },
    ...(otherProblems.length > 0 ? { problems: otherProblems } : {}),
    ...(missingLines.length > 0
      ? {
          short: {
            copies: missingCopies,
            cost: (stats.costToComplete as { text: string }).text,
            cards: missingLines.map((entry) =>
              entry.price === null
                ? `${entry.name} (${entry.missing})`
                : `${entry.name} (${entry.missing} × ${entry.price})`,
            ),
          },
        }
      : {}),
    ...includedSections(view, input, fullPayload),
    more: 'cards: [names] for full detail; boards: ["maybe"] for maybeboard text; include: prices | ids | owners | tokens | odds | sources | legality | list | formatRules.',
  };
  const budget =
    MAX_TOOL_RESPONSE_BYTES - jsonByteLength(header) - jsonByteLength(footer) - PAGE_MARGIN_BYTES;
  const page = pageCompactGroups(groups, Math.max(budget, 4_000), 0);
  return {
    ...header,
    cards: page.cards,
    ...(page.next !== undefined ? { next: page.next } : {}),
    ...footer,
  };
}

type ShortLine = Readonly<{ name: string; missing: number; price: string | null }>;

/** The cards the deck uses more copies of than the player owns, with the price of one. */
function shortLinesOf(view: DeckView, problems: readonly DeckProblem[]): ShortLine[] {
  return problems.flatMap((problem) => {
    if (problem.kind !== "Short") return [];
    const line = view.lines.find(
      (candidate) => candidate.oracleId === problem.oracleId && candidate.board !== "maybe",
    );
    const missing = Math.max(0, problem.needed - problem.owned);
    if (missing === 0) return [];
    const priceCents = line?.priceCents ?? null;
    return [
      { name: problem.name, missing, price: priceCents === null ? null : money(priceCents).text },
    ];
  });
}

/** The extra sections the compact view was asked for with `include`. */
function includedSections(
  view: DeckView,
  input: PresentInput,
  fullPayload: Record<string, unknown>,
): Record<string, unknown> {
  const wanted = new Set(input.include);
  const played = view.lines;
  const sections: Record<string, unknown> = {};
  if (wanted.has("prices")) {
    sections.prices = {
      value: (fullPayload.stats as { value: { text: string } }).value.text,
      cards: Object.fromEntries(
        played.flatMap((line) =>
          line.priceCents === null || line.isBasicLand
            ? []
            : [[line.name, money(line.priceCents).text] as const],
        ),
      ),
    };
  }
  if (wanted.has("ids")) {
    sections.ids = Object.fromEntries(
      played.map((line) => [line.name, { oracleId: line.oracleId, printingId: line.printingId }]),
    );
  }
  if (wanted.has("owners")) {
    sections.owners = Object.fromEntries(
      played
        .filter((line) => !line.isBasicLand)
        .map((line) => [
          line.name,
          {
            owned: line.owned,
            ...(line.ownedReal > 0 ? { real: line.ownedReal } : {}),
            free: line.free,
            ...(line.otherDecks.length > 0
              ? {
                  otherDecksCount: line.otherDecks.length,
                  otherDecks: line.otherDecks
                    .slice(0, 3)
                    .map((use) => `${use.name} (${use.quantity})`),
                }
              : {}),
          },
        ]),
    );
  }
  if (wanted.has("tokens")) sections.tokens = fullPayload.tokens;
  if (wanted.has("odds")) sections.openingHandOdds = fullPayload.openingHandOdds;
  if (wanted.has("sources")) sections.deckSources = fullPayload.deckSources;
  if (wanted.has("legality")) sections.cardLegalIn = fullPayload.cardLegalIn;
  if (wanted.has("list")) sections.list = fullPayload.list;
  if (wanted.has("formatRules")) {
    sections.formatRules = fullPayload.formatRules;
    sections.roleTargets = fullPayload.roleTargets;
  }
  return sections;
}
