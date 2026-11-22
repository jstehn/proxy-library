import type { DeckLine, Grouping } from "@/modules/decks";
import { mainType, TYPE_ORDER } from "@/modules/decks/client";
import { isLand, TAGS } from "@/shared/mtg";
import { TAG_LABELS } from "@/app/decks/labels";

// How the deck list groups a deck's lines (design doc 14, section 2.4): by type, by the deck's own
// headings (design doc 34) or by role (design doc 19), with the sideboard and maybeboard after.

export type Group = Readonly<{
  title: string;
  lines: DeckLine[];
  /** Shown closed until opened: the maybeboard (design doc 32). */
  collapsed?: boolean;
  /** The deck's own heading this group is (design doc 34), for its ↑ ↓ and Rename buttons. */
  heading?: string;
}>;

const sortedByCost = (group: readonly DeckLine[]) =>
  [...group].sort((a, b) => a.manaValue - b.manaValue || a.name.localeCompare(b.name));

/** The sideboard, then the maybeboard (closed until opened), after the main deck's groups. */
export function sideboardGroup(lines: readonly DeckLine[]): Group[] {
  const side = lines.filter((line) => line.board === "side");
  const maybe = lines.filter((line) => line.board === "maybe");
  return [
    ...(side.length > 0 ? [{ title: "Sideboard", lines: sortedByCost(side) }] : []),
    ...(maybe.length > 0
      ? [{ title: "Maybeboard", lines: sortedByCost(maybe), collapsed: true }]
      : []),
  ];
}

/**
 * The main deck by role, then the sideboard. A card with two roles shows under both; the counts
 * then add up to more than the deck, as the role statistics do.
 */
export function groupsByRole(lines: readonly DeckLine[]): Group[] {
  const main = lines.filter((line) => line.board === "main");
  const groups: Group[] = TAGS.map((tag) => ({
    title: TAG_LABELS[tag],
    lines: sortedByCost(main.filter((line) => line.roles.includes(tag))),
  }));
  const lands = main.filter((line) => isLand(line.typeLine) && line.roles.length === 0);
  const other = main.filter((line) => !isLand(line.typeLine) && line.roles.length === 0);
  groups.push(
    { title: "Other", lines: sortedByCost(other) },
    { title: "Lands", lines: sortedByCost(lands) },
  );
  return [...groups.filter((group) => group.lines.length > 0), ...sideboardGroup(lines)];
}

/** The deck in display order: commander, the main deck by type, then the sideboard. */
export function groupsOf(lines: readonly DeckLine[]): Group[] {
  return [...typeGroups(lines.filter((line) => line.board === "main")), ...sideboardGroup(lines)];
}

/**
 * The main deck by the deck's own headings, in its order, then the cards with no heading in
 * their usual groups by type (design doc 34, decision 2), then the sideboard.
 */
export function groupsByHeading(lines: readonly DeckLine[], headings: readonly string[]): Group[] {
  const main = lines.filter((line) => line.board === "main");
  const headed: Group[] = headings
    .map((heading) => ({
      title: heading,
      heading,
      lines: sortedByCost(main.filter((line) => line.heading === heading)),
    }))
    .filter((group) => group.lines.length > 0);
  const rest = main.filter((line) => line.heading === null || !headings.includes(line.heading));
  return [...headed, ...typeGroups(rest), ...sideboardGroup(lines)];
}

/** Main-deck lines grouped by card type: Creatures, Planeswalkers, ... Lands, Other. */
function typeGroups(main: readonly DeckLine[]): Group[] {
  const byType = new Map<string, DeckLine[]>();
  for (const line of main) {
    const type = mainType(line.typeLine);
    byType.set(type, [...(byType.get(type) ?? []), line]);
  }
  const plural = (type: string) => (type === "Sorcery" ? "Sorceries" : `${type}s`);
  return [...TYPE_ORDER, "Other"]
    .filter((type) => byType.has(type))
    .map((type) => ({
      title: type === "Other" ? "Other" : plural(type),
      lines: sortedByCost(byType.get(type) ?? []),
    }));
}

/**
 * Every card of the deck once, in the order the deck list shows them: the commanders, then the
 * groups of the deck's grouping (by type or by heading), then the sideboard and maybeboard. The
 * selected card's Previous and Next buttons step through it. A card on two boards comes once, where
 * it shows first.
 */
export function deckOrder(
  lines: readonly DeckLine[],
  grouping: Grouping,
  headings: readonly string[],
): DeckLine[] {
  const groups = grouping === "custom" ? groupsByHeading(lines, headings) : groupsOf(lines);
  const shown = [
    ...lines.filter((line) => line.board === "commander"),
    ...groups.flatMap((group) => group.lines),
  ];
  const seen = new Set<string>();
  return shown.filter((line) => {
    if (seen.has(line.oracleId)) return false;
    seen.add(line.oracleId);
    return true;
  });
}
