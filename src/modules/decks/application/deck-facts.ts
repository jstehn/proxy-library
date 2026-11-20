import { formatRules } from "../domain/format-rules";
import { ok, type Result } from "@/shared/kernel";
import { bracketLine, estimateBracket, type BracketEstimate } from "../domain/brackets";
import { isPlayed } from "../domain/boards";
import type { DeckAuditReport } from "../domain/audit-report";
import type { DeckLine, DeckView } from "../domain/deck-view";

// The deck-facts diagnostics (legality, bracket, roles, mana, ownership, goldfish) for a deck
// already read: the audit's numbers, plus the cards behind each role count and the bracket
// estimate if the maybeboard came in. Heuristics: callers present them as such.

export type DeckFactsReaders = Readonly<{
  /** The full audit of a deck's view (legality, bracket, roles, mana, ownership, goldfish). */
  audit(view: DeckView): Promise<DeckAuditReport>;
}>;

export type DeckFacts = Readonly<{
  report: DeckAuditReport;
  roleCards: Readonly<Record<string, string[]>>;
  /** Only when asked for, and only in Commander. */
  bracketWithMaybe?: BracketEstimate | null;
}>;

const COUNTED_ROLES = ["ramp", "draw", "removal", "wipe"] as const;

/** The cards behind each role count, tagged the same way the counts are. */
export function cardsBehindRoleCounts(lines: readonly DeckLine[]): Record<string, string[]> {
  const roleCards: Record<string, string[]> = { ramp: [], draw: [], removal: [], wipe: [] };
  for (const line of lines) {
    if (!isPlayed(line.board)) continue;
    for (const role of COUNTED_ROLES) {
      if (line.roles.includes(role) && !roleCards[role].includes(line.name)) {
        roleCards[role].push(line.name);
      }
    }
  }
  return roleCards;
}

export function makeDeckFacts(readers: DeckFactsReaders) {
  async function deckFacts(
    request: Readonly<{ view: DeckView; includeMaybe: boolean }>,
  ): Promise<Result<DeckFacts, never>> {
    const { view, includeMaybe } = request;
    const report = await readers.audit(view);
    const withMaybe =
      includeMaybe && formatRules(view.deck.format).bracketsApply
        ? estimateBracket(
            view.deck.format,
            view.lines.filter((l) => isPlayed(l.board) || l.board === "maybe").map(bracketLine),
          )
        : undefined;
    return ok({
      report,
      roleCards: cardsBehindRoleCounts(view.lines),
      ...(withMaybe ? { bracketWithMaybe: withMaybe } : {}),
    });
  }
  return deckFacts;
}
