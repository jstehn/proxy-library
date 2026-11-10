// Bracket flags (design doc 31, section 3.1): what about a card matters to Wizards' Commander
// Brackets. Game Changers come from Scryfall's own list (stored on the printing); land denial and
// extra turns are read from the rules text, like role tags (design doc 19). Heuristics: they
// explain an estimate, they never decide whether a deck is allowed.
import type { TagFacts } from "./tags";

export const BRACKET_FLAGS = ["gameChanger", "landDenial", "extraTurn"] as const;
/** A reason a card counts against a bracket. A card can have several, or none. */
export type BracketFlag = (typeof BRACKET_FLAGS)[number];

/** What the flag rules read: a card's text, plus Scryfall's Game Changer flag. */
export type BracketFacts = TagFacts & Readonly<{ isGameChanger: boolean }>;

const rule = (source: string) => new RegExp(source, "i");

/** One text rule: the flag and the patterns that find it (reminder text removed). */
type BracketTextRule = Readonly<{ flag: Exclude<BracketFlag, "gameChanger">; patterns: RegExp[] }>;

export const BRACKET_TEXT_RULES: readonly BracketTextRule[] = [
  {
    // Mass land denial, including Blood Moon and Back to Basics (design doc 31, decision 2).
    flag: "landDenial",
    patterns: [
      // Armageddon, Ravages of War, Ruination, Jokulhaups: "destroy all [artifacts, …] lands".
      rule(String.raw`\b(destroy|exile) all (?![^.]*\byou control\b)[^.]*\blands\b`),
      // Sunder: every land back to hand.
      rule(String.raw`\breturn all (nonbasic )?lands\b`),
      // Wildfire, Destructive Force: "each player sacrifices four lands".
      rule(String.raw`\beach player sacrifices [^.]*\blands\b`),
      // Global Ruin, Cataclysm-style: keep one of each, "sacrifices the rest".
      rule(String.raw`\bchooses from the lands they control\b[^.]*\bsacrifices the rest\b`),
      // Back to Basics, Hokori: lands stay tapped.
      rule(String.raw`\b(nonbasic )?lands don't untap\b`),
      // Winter Orb, Static Orb, Stasis: untapping is limited for everyone.
      rule(String.raw`\bplayers can't untap more than\b`),
      rule(String.raw`\bplayers skip their untap steps\b`),
      // Blood Moon, Magus of the Moon: nonbasic lands lose their abilities.
      rule(String.raw`\bnonbasic lands are (mountains|islands|swamps|forests|plains)\b`),
    ],
  },
  {
    // Time Warp, Nexus of Fate, Time Stretch. Not Stranglehold ("would begin an extra turn").
    flag: "extraTurn",
    patterns: [rule(String.raw`\btakes? (an|two|three|\w+) extra turns?\b`)],
  },
];

/** Rules text without reminder text, as the tag rules read it. */
function withoutReminders(text: string): string {
  return text.replace(/\([^)]*\)/g, "");
}

/** Text flags only: land denial and extra turns, in BRACKET_FLAGS order. Stored per printing. */
export function textBracketFlags(card: TagFacts): BracketFlag[] {
  const text = withoutReminders(card.text);
  return BRACKET_TEXT_RULES.filter((row) => row.patterns.some((pattern) => pattern.test(text))).map(
    (row) => row.flag,
  );
}

/**
 * Every bracket flag a card has, in BRACKET_FLAGS order. Game Changer status isn't stored with
 * the text flags: Wizards changes the list, and the nightly Scryfall pass keeps it current.
 */
export function bracketFlags(card: BracketFacts): BracketFlag[] {
  const fromText = textBracketFlags(card);
  return card.isGameChanger ? ["gameChanger", ...fromText] : fromText;
}
