import {
  type DeckView,
  type ManaBasePlanWithCastability,
  type OverviewParts,
} from "@/modules/decks";
import { landReasonText, landTargetReasonText } from "@/app/decks/labels";
import { heuristicProvenance, moneyOrNull } from "../../tool";
import { compactMoneyFields, stripProvenance } from "../money";

import { compactDeckPayload } from "./compact";
import { fullDeckPayload } from "./full";
import type { GetDeckAnswer, PresentInput } from "./input";
export type { GetDeckAnswer, PresentInput } from "./input";

// What get_deck says (design doc 61, section 5a); these functions only reshape what the
// capabilities answered, and never query.

/** The parts of the overview this request reads, so a plain call stays cheap. */
export function overviewPartsFor(input: PresentInput): OverviewParts {
  if (input.cards !== undefined) return {};
  const full = input.view === "full";
  const wants = (name: string) => input.include.includes(name);
  return {
    profile: true,
    tokens: full || wants("tokens"),
    sources: full || wants("sources"),
    odds: full || wants("odds"),
  };
}

/** get_deck's answer for the model: the deck, plus whatever extra sections were asked for. */
export function presentGetDeck(answer: GetDeckAnswer, request: PresentInput): unknown {
  const { overview } = answer;
  // Oracle text is asked for with `includeText` or with include: ["text"].
  const input = {
    ...request,
    includeText: request.includeText || request.include.includes("text"),
  };
  let payload: Record<string, unknown>;
  if (input.cards !== undefined) {
    payload = deckCardDetails(overview.view, input.cards);
  } else {
    const full = fullDeckPayload(overview, input);
    payload = input.view === "full" ? full : compactDeckPayload(overview, input, full);
  }
  const result = compactMoneyFields(payload) as Record<string, unknown>;

  if (answer.facts !== undefined) {
    // The audit's whole-deck score is for the builder's screens; the tool shows the facts only.
    const facts = Object.fromEntries(
      Object.entries(answer.facts.report).filter(([name]) => name !== "score"),
    );
    result.facts = compactMoneyFields({
      ...facts,
      roleCards: answer.facts.roleCards,
      ...(answer.facts.bracketWithMaybe ? { bracketWithMaybe: answer.facts.bracketWithMaybe } : {}),
    });
  }
  if (answer.signals !== undefined) result.signals = answer.signals;
  if (answer.manaPlan !== undefined) result.manaPlan = manaPlanPayload(answer.manaPlan);
  if (input.include.includes("primer") && overview.profile) {
    result.primer = overview.profile.primer ?? "";
  }
  return result;
}

/** Full detail for the named cards in the deck (get_deck's `cards` input). */
function deckCardDetails(view: DeckView, names: readonly string[]): Record<string, unknown> {
  const notInDeck: string[] = [];
  const cards = names.flatMap((query) => {
    const needle = query.trim().toLowerCase();
    const matches = view.lines.filter((line) => {
      const fullName = line.name.toLowerCase();
      return (
        fullName === needle ||
        fullName.split(" // ").some((face) => face === needle) ||
        line.oracleId === query
      );
    });
    if (matches.length === 0) notInDeck.push(query);
    return matches.map((line) => ({
      name: line.name,
      board: line.board,
      quantity: line.quantity,
      ...(line.heading !== null ? { heading: line.heading } : {}),
      ...(line.note !== null ? { note: line.note } : {}),
      ...((line.tags ?? []).length > 0 ? { tags: line.tags } : {}),
      ...(line.role ? { role: line.role } : {}),
      ...(line.pinned ? { pinned: true } : {}),
      manaCost: line.manaCost,
      typeLine: line.typeLine,
      ...(line.printedStats ? { stats: line.printedStats } : {}),
      text:
        line.faceTexts !== undefined && line.faceTexts.length > 1
          ? line.faceTexts.join("\n//\n")
          : line.text,
      ...(line.keywords.length > 0 ? { keywords: line.keywords } : {}),
      ...(line.isGameChanger ? { isGameChanger: true } : {}),
      oracleId: line.oracleId,
      printingId: line.printingId,
      owned: line.owned,
      ...(line.ownedReal > 0 ? { ownedReal: line.ownedReal } : {}),
      free: line.free,
      ...(line.otherDecks.length > 0
        ? {
            otherDecks: line.otherDecks.map((use) => ({
              deckId: use.deckId,
              name: use.name,
              quantity: use.quantity,
            })),
          }
        : {}),
      price: moneyOrNull(line.priceCents),
    }));
  });
  return {
    deck: { id: view.deck.id, name: view.deck.name },
    cards,
    ...(notInDeck.length > 0 ? { notInDeck } : {}),
  };
}

/** The mana-base skeleton (mana_base_skeleton's answer), prices as plain cents. */
function manaPlanPayload(plan: ManaBasePlanWithCastability): unknown {
  const describeLand = (land: (typeof plan.add)[number]) => ({
    name: land.card.name,
    quantity: land.quantity,
    kind: land.card.isBasicLand ? "basic" : land.card.priceCents === null ? "owned" : "store",
    tapped: land.tapped,
    why: land.reasons.map(landReasonText),
    alsoIn: land.card.alsoIn,
  });
  const struggling = (list: typeof plan.castability.before.struggling) =>
    list.slice(0, 8).map((s) => ({
      name: s.name,
      manaCost: s.manaCost,
      castOnCurvePct: Math.round(s.castOnCurvePct * 100),
      bottleneckColor: s.bottleneckColor,
    }));
  return compactMoneyFields(
    stripProvenance({
      provenance: heuristicProvenance("mana-curve & pip-share heuristic", ["card text", "edhrec"]),
      outputKind: "skeleton",
      lands: plan.lands,
      landTarget: plan.landTarget.lands,
      landTargetWhy: plan.landTarget.reasons.map(landTargetReasonText),
      over: plan.over,
      sources: plan.sources.map((source) => ({
        color: source.color,
        have: source.have,
        target: source.target,
        mostOfItInOneCost: source.heaviestCost,
      })),
      add: plan.add.map(describeLand),
      considerBuying: plan.considerBuying.map((land) => ({
        ...describeLand(land),
        price: moneyOrNull(land.card.priceCents),
      })),
      castability: {
        averageBeforePct: Math.round(plan.castability.before.averageCastOnCurvePct * 100),
        averageAfterPct: Math.round(plan.castability.after.averageCastOnCurvePct * 100),
        strugglingBefore: struggling(plan.castability.before.struggling),
        strugglingAfter: struggling(plan.castability.after.struggling),
      },
    }),
  );
}
