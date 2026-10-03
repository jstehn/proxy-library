// Role tags (design doc 19, section 3): the job a card does in a deck, read from its rules text.
// Rules as data: one row per tag, each a list of regular expressions. They're heuristics for
// counting roles, never rules a deck must follow, so a rare miss or false match is acceptable.

export const TAGS = ["ramp", "draw", "removal", "wipe", "counter", "tutor", "protection"] as const;
/** A job a card does in a deck. A card can have several, or none. */
export type Tag = (typeof TAGS)[number];

/** What the tag rules read: the type line, every face's rules text, and the mana it makes. */
export type TagFacts = Readonly<{
  typeLine: string;
  text: string;
  producedMana?: readonly string[];
}>;

type TagRule = Readonly<{
  tag: Tag;
  /** The card has the tag if any pattern matches its text (reminder text removed). */
  patterns: readonly RegExp[];
  /** Another way to qualify, from structured facts rather than text. */
  facts?: (card: TagFacts) => boolean;
  /** Lands never get this tag: a land that taps for mana is a land, not ramp. */
  notOnLands?: boolean;
}>;

/** Card types a removal spell can hit, as a pattern piece. */
const PERMANENT_TYPE = String.raw`(creature|artifact|enchantment|planeswalker|permanent|battle)s?\b`;
/** Land-like words that make a library search "ramp" rather than a "tutor". */
const LAND_WORDS = String.raw`(land|forest|plains|island|swamp|mountain|basic)`;

const rule = (source: string) => new RegExp(source, "i");

export const TAG_RULES: readonly TagRule[] = [
  {
    tag: "ramp",
    notOnLands: true,
    // Sol Ring, Llanowar Elves, Arcane Signet: a non-land that makes mana.
    facts: (card) => (card.producedMana ?? []).length > 0,
    patterns: [
      // Cultivate, Rampant Growth, Nature's Lore: lands from the library onto the battlefield.
      rule(String.raw`search your library for [^.]*\b${LAND_WORDS}s?\b[^.]*battlefield`),
      // Exploration, Azusa: more land drops; Growth Spiral: a land from your hand.
      rule(String.raw`\bplay (an|two|\w+) additional lands?\b`),
      rule(String.raw`\bput (a|an|up to \w+) land cards? from your hand onto the battlefield`),
      // Dockside Extortionist, Smothering Tithe: Treasure.
      rule(String.raw`\bcreates? [^.]*\btreasure tokens?\b`),
    ],
  },
  {
    tag: "draw",
    patterns: [
      // Rhystic Study, Divination, Harmonize. Not a condition: "whenever an opponent draws a card"
      // (Smothering Tithe) or "if you would draw a card" (a replacement effect).
      rule(
        String.raw`(?<!\b(whenever|when|if)\b[^,.]*)\bdraws? (a|an|one|two|three|four|five|six|seven|x|that many|\d+) (additional )?cards?\b`,
      ),
      rule(String.raw`\bdraws? cards equal to\b`),
    ],
  },
  {
    tag: "removal",
    patterns: [
      // Swords to Plowshares, Murder, Banishing Light; not "target creature card from a
      // graveyard" or "target creature you control" (a flicker).
      rule(
        String.raw`\b(destroy|exile)\b[^.]*?\btarget\b[^.]*?\b${PERMANENT_TYPE}(?! cards?\b)(?! you control)`,
      ),
      // Lightning Bolt, Fiery Confluence's modes.
      rule(
        String.raw`\bdeals? [^.]*?damage to (any target|(up to \w+ )?(another )?target (attacking |blocking |tapped )?(creature|planeswalker|battle))`,
      ),
      // Bites and fights.
      rule(String.raw`\bfights? (up to one )?(another )?target creature`),
      rule(String.raw`\btarget (\w+ )?creature [^.]*?\bgets -(\d+|x)/-(\d+|x)`),
      // Pacifism, Journey to Nowhere is above.
      rule(String.raw`\benchanted creature can't attack or block\b`),
      // Bounce.
      rule(
        String.raw`\breturn (up to one )?target (nonland permanent|creature|permanent)(?! you control)[^.]* to its owner's hand`,
      ),
    ],
  },
  {
    tag: "wipe",
    patterns: [
      // Wrath of God, Damnation, Farewell.
      rule(
        String.raw`\b(destroy|exile) all\b[^.]*?\b(creatures|permanents|artifacts|enchantments|planeswalkers)\b(?! you control)`,
      ),
      // Blasphemous Act, Pyroclasm.
      rule(String.raw`\bdamage to each (other )?(non\w+ )?creature\b(?! you control)`),
      // Toxic Deluge.
      rule(String.raw`\b(all|each) (other )?creatures? (get|gets) -(\d+|x)/-(\d+|x)`),
      // Evacuation, Cyclonic Rift (overloaded).
      rule(
        String.raw`\breturn (all|each) (nonland )?(permanent|creature)s?\b(?! you control)[^.]* to (its|their) owners?'? hands?`,
      ),
    ],
  },
  {
    tag: "counter",
    // Counterspell, Negate, Stifle; "+1/+1 counter on target" doesn't match.
    patterns: [rule(String.raw`\bcounter (up to one )?target\b[^.]*?\b(spell|ability)\b`)],
  },
  {
    tag: "tutor",
    // Demonic Tutor, Enlightened Tutor; land searches are ramp, and "cards named" just thins.
    patterns: [
      rule(
        String.raw`\bsearch your library for (?![^.]*\b${LAND_WORDS}\b)(?![^.]*\bnamed\b)[^.]*?\bcards?\b`,
      ),
    ],
  },
  {
    tag: "protection",
    patterns: [
      // Heroic Intervention, Flawless Maneuver.
      rule(
        String.raw`\b(other )?(creatures|permanents) you control (gain|have) (hexproof|indestructible|protection|shroud)`,
      ),
      // Tamiyo's Safekeeping, Blossoming Defense.
      rule(
        String.raw`\btarget (creature|permanent|artifact|planeswalker)( or \w+)? you control gains (hexproof|indestructible|protection|shroud)`,
      ),
      // Swiftfoot Boots, Lightning Greaves.
      rule(
        String.raw`\bequipped creature [^.]*?\b(hexproof|indestructible|shroud|protection from)`,
      ),
      // Leyline of Sanctity, Teferi's Protection.
      rule(String.raw`\byou (have|gain) (hexproof|shroud|protection from)`),
      rule(String.raw`\bphases? out\b`),
    ],
  },
];

/** Whether the front face is a land ("Instant // Land" is an instant). */
function isLand(typeLine: string): boolean {
  return /\bLand\b/.test(typeLine.split(" // ")[0]);
}

/** Rules text without reminder text: "(… draw a card …)" in a keyword's reminder doesn't count. */
function withoutReminders(text: string): string {
  return text.replace(/\([^)]*\)/g, "");
}

/** The roles a card plays, in TAGS order. */
export function cardTags(card: TagFacts): Tag[] {
  const text = withoutReminders(card.text);
  const land = isLand(card.typeLine);
  return TAG_RULES.filter(
    (row) =>
      !(row.notOnLands && land) &&
      ((row.facts?.(card) ?? false) || row.patterns.some((pattern) => pattern.test(text))),
  ).map((row) => row.tag);
}
