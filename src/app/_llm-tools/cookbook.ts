import type { SynergyQuery } from "@/modules/decks";

// The synergy cookbook (design doc 28, section 3.5): tested search patterns for common
// mechanics, each split into enablers (cards that make it happen) and payoffs (cards that reward
// it). Data, not prose: a test parses every query (rule 15). get_search_guide serves it.

export type CookbookEntry = Readonly<{
  mechanic: string;
  whenToUse: string;
  enablers: readonly SynergyQuery[];
  payoffs: readonly SynergyQuery[];
}>;

export const COOKBOOK: readonly CookbookEntry[] = [
  {
    mechanic: "Treasure",
    whenToUse: "Commanders that make, count or sacrifice Treasures (Jolene, the Plunder Queen).",
    enablers: [{ synergy: "Treasure makers", search: "o:/create[^.]*treasure/" }],
    payoffs: [
      { synergy: "Treasure payoffs", search: "o:/(whenever|for each)[^.]*treasures?/" },
      {
        synergy: "Artifact sacrifice payoffs",
        search: "o:/whenever [^.]*artifacts? [^.]*(is|are) (put into|sacrificed)/",
      },
    ],
  },
  {
    mechanic: "Artifacts matter",
    whenToUse: "Commanders that reward casting, having or sacrificing artifacts.",
    enablers: [
      { synergy: "Cheap artifacts", search: "t:artifact mv<=2 -t:land" },
      {
        synergy: "Artifact token makers",
        search: "o:/create[^.]*(treasure|clue|food|blood|map|powerstone|artifact)[^.]*token/",
      },
    ],
    payoffs: [
      {
        synergy: "Artifact payoffs",
        search: "o:/(whenever|for each)[^.]*artifacts?[^.]*(enters|you control|cast)/",
      },
      { synergy: "Artifact sacrifice outlets", search: "o:/sacrifice (a|an|another) artifact/" },
    ],
  },
  {
    mechanic: "Sacrifice (aristocrats)",
    whenToUse: "Decks that turn creatures dying into value.",
    enablers: [
      {
        synergy: "Sacrifice outlets",
        search: "o:/sacrifice (a|an|another) (creature|permanent)[^.]*:/",
      },
      { synergy: "Fodder makers", search: "o:/create[^.]*creature tokens?/ mv<=4" },
    ],
    payoffs: [
      { synergy: "Dies payoffs", search: "o:/whenever [^.]*(creature|another)[^.]* dies/" },
      { synergy: "Drain on death", search: "o:/dies[^.]*(each opponent loses|you gain)/" },
    ],
  },
  {
    mechanic: "Tokens",
    whenToUse: "Go-wide decks and token-doubling commanders.",
    enablers: [{ synergy: "Token makers", search: "theme:tokens" }],
    payoffs: [
      { synergy: "Token payoffs", search: "o:/whenever [^.]*tokens? [^.]*enters?/" },
      { synergy: "Anthems", search: "o:/creatures you control get \\+/" },
      {
        synergy: "Token doublers",
        search: "o:/(twice that many|that many plus one|additional)[^.]*tokens?/",
      },
    ],
  },
  {
    mechanic: "+1/+1 and other counters",
    whenToUse:
      "Decks full of counters of any kind (+1/+1, spore, charge, oil…): proliferate and doublers.",
    enablers: [
      { synergy: "Counter placers", search: "o:/put [^.]*\\+1\\/\\+1 counters?/" },
      { synergy: "Proliferate", search: "o:proliferate" },
    ],
    payoffs: [
      {
        synergy: "Counter doublers",
        search: "o:/(twice that many|that many plus one|additional)[^.]*counters?/",
      },
      { synergy: "Counter payoffs", search: "o:/(whenever|for each)[^.]*counters?/" },
    ],
  },
  {
    mechanic: "Landfall and lands",
    whenToUse: "Commanders that care about lands entering or being played.",
    enablers: [
      { synergy: "Extra land drops", search: "o:/play (an|two) additional lands?/" },
      { synergy: "Land ramp", search: "o:/search your library for [^.]*land[^.]*battlefield/" },
    ],
    payoffs: [
      { synergy: "Landfall payoffs", search: "o:/landfall|whenever a land( you control)? enters/" },
    ],
  },
  {
    mechanic: "Enters the battlefield and blink",
    whenToUse: "Decks of creatures with enters triggers.",
    enablers: [{ synergy: "Blink", search: "o:/exile [^.]*(return|then return)[^.]*battlefield/" }],
    payoffs: [
      { synergy: "Enters triggers", search: "t:creature o:/when ~ enters/" },
      {
        synergy: "Trigger doublers",
        search: "o:/(triggers an additional time|trigger an additional time)/",
      },
    ],
  },
  {
    mechanic: "Spells matter",
    whenToUse: "Instant and sorcery decks.",
    enablers: [{ synergy: "Cheap spells", search: "(t:instant or t:sorcery) mv<=2" }],
    payoffs: [
      {
        synergy: "Spell payoffs",
        search: "o:/whenever you cast (an|a) (instant|sorcery|noncreature)/",
      },
      { synergy: "Copy spells", search: "o:/copy (target|that) (instant|sorcery|spell)/" },
    ],
  },
  {
    mechanic: "Graveyard and recursion",
    whenToUse: "Reanimator, self-mill and recursion decks.",
    enablers: [{ synergy: "Self-mill", search: "o:/mill|surveil|put the top [^.]*graveyard/" }],
    payoffs: [
      {
        synergy: "Reanimation",
        search: "o:/return [^.]*creature card[^.]*graveyard[^.]*battlefield/",
      },
      { synergy: "Cast from graveyard", search: "o:/cast [^.]*from your graveyard/" },
    ],
  },
  {
    mechanic: "Lifegain",
    whenToUse: "Decks that gain life often.",
    enablers: [{ synergy: "Life gain", search: "kw:lifelink or o:/you gain [^.]*life/" }],
    payoffs: [{ synergy: "Lifegain payoffs", search: "o:/whenever you gain life/" }],
  },
  {
    mechanic: "Equipment and Auras",
    whenToUse: "Voltron and equipment commanders.",
    enablers: [{ synergy: "Equipment and Auras", search: "t:equipment or t:aura" }],
    payoffs: [
      {
        synergy: "Equipped or enchanted payoffs",
        search: "o:/(equipped|enchanted) creature|whenever [^.]*(equipment|aura)/",
      },
    ],
  },
  {
    mechanic: "A creature type",
    whenToUse: "Tribal decks: replace Elf with the deck's type in both queries.",
    enablers: [{ synergy: "Elves", search: "t:elf" }],
    payoffs: [{ synergy: "Elf payoffs", search: "o:/(elf|elves)( you control| spells?)?/ -t:elf" }],
  },
  {
    mechanic: "Extra combats and attacking",
    whenToUse: "Aggressive commanders with attack triggers.",
    enablers: [{ synergy: "Extra combats", search: 'o:"additional combat phase"' }],
    payoffs: [{ synergy: "Attack payoffs", search: "o:/whenever [^.]*attacks/" }],
  },
  {
    mechanic: "Card draw payoffs",
    whenToUse: "Decks that draw many cards a turn.",
    enablers: [{ synergy: "Card draw", search: "tag:draw" }],
    payoffs: [{ synergy: "Draw payoffs", search: "o:/whenever you draw/" }],
  },
  {
    mechanic: "Mana base",
    whenToUse: "Fixing lands for the deck's colors (the deck's colors are applied for you).",
    enablers: [
      {
        synergy: "Dual lands",
        search:
          "is:dual or is:shockland or is:checkland or is:painland or is:fastland or is:slowland",
      },
      { synergy: "Fetch and tri lands", search: "is:fetchland or is:triome or is:pathway" },
    ],
    payoffs: [{ synergy: "Utility lands", search: "t:land -t:basic o:/:/ -is:dual" }],
  },
];

/** Every query in the cookbook, for its test. */
export function cookbookQueries(): SynergyQuery[] {
  return COOKBOOK.flatMap((entry) => [...entry.enablers, ...entry.payoffs]);
}

/** The cookbook as Markdown, for get_search_guide. */
export function cookbookText(): string {
  const entries = COOKBOOK.map((entry) => {
    const lines = (title: string, queries: readonly SynergyQuery[]) =>
      queries.map((query) => `- ${title} · ${query.synergy}: \`${query.search}\``).join("\n");
    return [
      `## ${entry.mechanic}`,
      entry.whenToUse,
      lines("Enabler", entry.enablers),
      lines("Payoff", entry.payoffs),
    ].join("\n");
  });
  return [
    "# Synergy cookbook",
    "Tested query patterns. Use them as starting points for search_for_deck: copy, then adapt to the deck. The deck's colors and legality are applied for you.",
    ...entries,
  ].join("\n\n");
}
