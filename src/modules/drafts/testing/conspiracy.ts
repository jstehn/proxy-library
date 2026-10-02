import { PrintingId } from "@/modules/catalog";
import { UserId, seededRng } from "@/shared/kernel";
import { abilityOf } from "../domain/abilities";
import type { DraftCardFacts } from "../domain/auto-pick";
import { addBot, startDraft, type Draft } from "../domain/draft";
import type { StepContext } from "../domain/steps";
import { sampleLobby, START } from "./samples";

// Tables of named cards, for testing draft abilities (design doc 18). A card's printing id is its
// name plus where it was opened ("Cogwork Spy@0.1.2": seat 0, round 1, slot 2), so every copy is
// its own card and its name is easy to read back.

const TYPE_LINES: Readonly<Record<string, string>> = {
  "Aether Searcher": "Artifact Creature — Construct",
  "Agent of Acquisitions": "Artifact Creature — Construct",
  "Animus of Predation": "Creature — Avatar",
  "Archdemon of Paliano": "Creature — Demon",
  "Canal Dredger": "Artifact Creature — Construct",
  "Cogwork Grinder": "Artifact Creature — Construct",
  "Cogwork Librarian": "Artifact Creature — Construct",
  "Cogwork Spy": "Artifact Creature — Bird Construct",
  "Cogwork Tracker": "Artifact Creature — Dog Construct",
  "Custodi Peacekeeper": "Creature — Human Cleric",
  "Deal Broker": "Artifact Creature — Construct",
  "Garbage Fire": "Instant",
  "Illusionary Informant": "Creature — Bird Illusion",
  "Leovold's Operative": "Creature — Elf Rogue",
  "Lore Seeker": "Artifact Creature — Construct",
  "Lurking Automaton": "Artifact Creature — Construct",
  "Noble Banneret": "Creature — Human Knight",
  "Paliano Vanguard": "Creature — Human Soldier",
  "Paliano, the High City": "Legendary Land",
  "Pyretic Hunter": "Creature — Elemental Cat",
  Regicide: "Instant",
  "Smuggler Captain": "Creature — Human Pirate",
  "Spire Phantasm": "Creature — Gargoyle Illusion",
  "Whispergear Sneak": "Artifact Creature — Construct",
  // Fillers
  Bear: "Creature — Bear",
  Elf: "Creature — Elf Druid",
  Bolt: "Instant",
  Brago: "Conspiracy",
};

export const nameOf = (printingId: string) => printingId.split("@")[0];

/** Facts for test cards: the name, a type line, and some strength so auto-picks have a favorite. */
export function conspiracyFacts(printingId: PrintingId): DraftCardFacts {
  const name = nameOf(printingId);
  return {
    name,
    rarity: abilityOf(name) !== null ? "uncommon" : "common",
    colors: [],
    manaCost: "{2}",
    manaValue: 2,
    typeLine: TYPE_LINES[name] ?? "Creature — Bear",
    producedMana: [],
    marketPrice: null,
  };
}

export const atSecond = (seconds: number) => new Date(START.getTime() + seconds * 1000);

export const contextAt = (seconds = 61, seed = "test"): StepContext => ({
  now: atSecond(seconds),
  cards: (id) => conspiracyFacts(id),
  rng: seededRng(seed),
});

/**
 * A started draft whose packs hold these cards: `packs[seat][round - 1]` lists card names.
 * `players` are people; `bots` more seats after them. Timer off unless given.
 */
export function conspiracyTable(
  packs: ReadonlyArray<ReadonlyArray<readonly string[]>>,
  options: { players?: string[]; bots?: number; timer?: Draft["timer"] } = {},
): Draft {
  const players =
    options.players ??
    packs.map((_, index) => `p${index}`).slice(0, packs.length - (options.bots ?? 0));
  let lobby = sampleLobby(players, { timer: options.timer ?? { kind: "off" } });
  for (let bot = 0; bot < (options.bots ?? 0); bot += 1) {
    const added = addBot(
      lobby,
      { userId: UserId.of(players[0]), isAdmin: true },
      atSecond(10 + bot),
    );
    if (!added.ok) throw new Error(added.error.kind);
    lobby = added.value;
  }
  const opened = packs.map((rounds, seat) =>
    rounds.map((names, round) => ({
      seed: `seed-${seat}-${round + 1}`,
      cards: names.map((name, slot) => ({
        printingId: PrintingId.of(`${name}@${seat}.${round + 1}.${slot}`),
        finish: "nonfoil" as const,
      })),
    })),
  );
  return startDraft(lobby, opened, atSecond(60));
}

/** The same filler pack, `size` cards. */
export const fillers = (size: number, name = "Bear") => Array.from({ length: size }, () => name);
