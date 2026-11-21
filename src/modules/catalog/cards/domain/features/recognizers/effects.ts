// Composable MTG effect primitives extracted from Oracle text and structured card facts.
// Open-Closed: new mechanics are added as EffectExtractor entries without modifying role/theme rules.

import { plainText } from "@/shared/mtg";

/** What the extractors read: one face's text, and the mana Scryfall says the card makes. */
export type EffectFacts = Readonly<{
  text: string;
  producedMana: readonly string[];
}>;

export type EffectSubject =
  | "creature"
  | "artifact"
  | "enchantment"
  | "planeswalker"
  | "battle"
  | "permanent"
  | "nonland_permanent"
  | "land"
  | "any_target"
  | "spell"
  | "ability"
  | "card";

export type EffectPrimitive =
  | Readonly<{ kind: "mana_production"; colors: readonly string[] }>
  | Readonly<{
      kind: "search_library";
      subject: "land" | "card";
      toZone: "battlefield" | "hand" | "top" | "other";
      namedOnly?: boolean;
    }>
  | Readonly<{ kind: "extra_land_play" }>
  | Readonly<{ kind: "put_land_from_hand" }>
  | Readonly<{
      kind: "create_token";
      tokenKind: "treasure" | "food" | "clue" | "artifact" | "creature" | "other";
    }>
  | Readonly<{ kind: "draw_cards"; conditional: boolean }>
  | Readonly<{
      kind: "destroy_or_exile";
      scope: "target" | "all";
      subject: EffectSubject;
      excludesYouControl: boolean;
      fromGraveyard: boolean;
    }>
  | Readonly<{
      kind: "damage";
      scope: "target" | "all";
      subject: EffectSubject;
      excludesYouControl: boolean;
    }>
  | Readonly<{
      kind: "modify_pt";
      scope: "target" | "all" | "opponents";
      negative: boolean;
    }>
  | Readonly<{ kind: "prevent_combat" }>
  | Readonly<{
      kind: "bounce";
      scope: "target" | "all";
      subject: EffectSubject;
      excludesYouControl: boolean;
    }>
  | Readonly<{ kind: "fight"; scope: "target" | "token_per_opponent_creature" }>
  | Readonly<{ kind: "sacrifice_all"; subject: EffectSubject }>
  | Readonly<{ kind: "counter_stack"; subject: "spell" | "ability" }>
  | Readonly<{
      kind: "grant_protection";
      scope: "you_control" | "target_you_control" | "equipped" | "you";
    }>
  | Readonly<{ kind: "phase_out" }>;

export interface EffectExtractor {
  readonly id: string;
  extract(card: EffectFacts, cleanText: string): readonly EffectPrimitive[];
}

const PERMANENT_TYPE = String.raw`(creature|artifact|enchantment|planeswalker|permanent|battle)s?\b`;
const LAND_WORDS = String.raw`(land|forest|plains|island|swamp|mountain|basic)`;
const rule = (source: string) => new RegExp(source, "i");

function parseSubject(raw: string | undefined): EffectSubject {
  if (!raw) return "permanent";
  const s = raw.toLowerCase();
  if (s.includes("nonland")) return "nonland_permanent";
  if (s.includes("creature")) return "creature";
  if (s.includes("artifact")) return "artifact";
  if (s.includes("enchantment")) return "enchantment";
  if (s.includes("planeswalker")) return "planeswalker";
  if (s.includes("battle")) return "battle";
  if (s.includes("land")) return "land";
  if (s.includes("any target")) return "any_target";
  if (s.includes("spell")) return "spell";
  if (s.includes("ability")) return "ability";
  if (s.includes("card")) return "card";
  return "permanent";
}

const manaProductionExtractor: EffectExtractor = {
  id: "mana_production",
  extract(card, text) {
    if (card.producedMana.length > 0) {
      return [{ kind: "mana_production", colors: card.producedMana }];
    }
    if (
      /whenever enchanted [^.]*is tapped for mana, its controller adds an additional/i.test(text) ||
      /\{T\}[^.]*:\s*add\s+(?:\{[WUBRGC]\}|one mana)/i.test(text)
    ) {
      return [{ kind: "mana_production", colors: [] }];
    }
    return [];
  },
};

const librarySearchExtractor: EffectExtractor = {
  id: "library_search",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    if (
      rule(String.raw`search your library for [^.]*\b${LAND_WORDS}s?\b[^.]*battlefield`).test(text)
    ) {
      out.push({ kind: "search_library", subject: "land", toZone: "battlefield" });
    }
    if (
      rule(
        String.raw`\bsearch your library for (?![^.]*\b${LAND_WORDS}\b)(?![^.]*\bnamed\b)[^.]*?\bcards?\b`,
      ).test(text)
    ) {
      out.push({ kind: "search_library", subject: "card", toZone: "other", namedOnly: false });
    }
    return out;
  },
};

const landDropExtractor: EffectExtractor = {
  id: "land_drop",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    if (rule(String.raw`\bplay (an|two|\w+) additional lands?\b`).test(text)) {
      out.push({ kind: "extra_land_play" });
    }
    if (
      rule(String.raw`\bput (a|an|up to \w+) land cards? from your hand onto the battlefield`).test(
        text,
      )
    ) {
      out.push({ kind: "put_land_from_hand" });
    }
    return out;
  },
};

const tokenCreationExtractor: EffectExtractor = {
  id: "token_creation",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    if (rule(String.raw`\bcreates? [^.]*\btreasure tokens?\b`).test(text)) {
      out.push({ kind: "create_token", tokenKind: "treasure" });
    }
    if (rule(String.raw`\bcreates? [^.]*\bfood tokens?\b`).test(text)) {
      out.push({ kind: "create_token", tokenKind: "food" });
    }
    if (rule(String.raw`\bcreates? [^.]*\bclue tokens?\b`).test(text)) {
      out.push({ kind: "create_token", tokenKind: "clue" });
    }
    if (rule(String.raw`\bcreates? [^.]*\bcreature tokens?\b`).test(text)) {
      out.push({ kind: "create_token", tokenKind: "creature" });
    }
    return out;
  },
};

const drawExtractor: EffectExtractor = {
  id: "draw",
  extract(_card, text) {
    const directDraw =
      rule(
        String.raw`(?<!\b(whenever|when|if)\b[^,.]*)\bdraws? (a|an|one|two|three|four|five|six|seven|x|that many|\d+) (additional )?cards?\b`,
      ).test(text) || rule(String.raw`\bdraws? cards equal to\b`).test(text);
    if (directDraw) return [{ kind: "draw_cards", conditional: false }];
    if (/\bdraws? a card\b/i.test(text)) return [{ kind: "draw_cards", conditional: true }];
    return [];
  },
};

const destroyExileExtractor: EffectExtractor = {
  id: "destroy_exile",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    const targetMatch = text.match(
      rule(
        String.raw`\b(destroy|exile)\b[^.]*?\btarget\b[^.]*?\b${PERMANENT_TYPE}(?! cards?\b)(?! you control)`,
      ),
    );
    if (targetMatch) {
      out.push({
        kind: "destroy_or_exile",
        scope: "target",
        subject: parseSubject(targetMatch[2]),
        excludesYouControl: true,
        fromGraveyard: false,
      });
    }
    const allMatch = text.match(
      rule(
        String.raw`\b(destroy|exile) all\b[^.]*?\b(creatures|permanents|artifacts|enchantments|planeswalkers)\b(?! you control)`,
      ),
    );
    if (allMatch) {
      out.push({
        kind: "destroy_or_exile",
        scope: "all",
        subject: parseSubject(allMatch[2]),
        excludesYouControl: true,
        fromGraveyard: false,
      });
    }
    return out;
  },
};

const damageExtractor: EffectExtractor = {
  id: "damage",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    const targetMatch = text.match(
      rule(
        String.raw`\bdeals? [^.]*?damage to (any target|(up to \w+ )?(another )?target (attacking |blocking |tapped )?(creature|planeswalker|battle))`,
      ),
    );
    if (targetMatch) {
      out.push({
        kind: "damage",
        scope: "target",
        subject: parseSubject(targetMatch[5] ?? targetMatch[1]),
        excludesYouControl: true,
      });
    }
    if (
      rule(String.raw`\bdamage to each (other )?(non\w+ )?creature\b(?! you control)`).test(text)
    ) {
      out.push({
        kind: "damage",
        scope: "all",
        subject: "creature",
        excludesYouControl: true,
      });
    }
    return out;
  },
};

const ptModifyExtractor: EffectExtractor = {
  id: "modify_pt",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    if (rule(String.raw`\btarget (\w+ )?creature [^.]*?\bgets -(\d+|x)/-(\d+|x)`).test(text)) {
      out.push({ kind: "modify_pt", scope: "target", negative: true });
    }
    if (
      rule(String.raw`\b(all|each) (other )?creatures? (get|gets) -(\d+|x)/-(\d+|x)`).test(text)
    ) {
      out.push({ kind: "modify_pt", scope: "all", negative: true });
    }
    if (
      rule(
        String.raw`\bcreatures (your opponents control|an opponent controls) (get|gets) -(\d+|x)/-(\d+|x)`,
      ).test(text)
    ) {
      out.push({ kind: "modify_pt", scope: "opponents", negative: true });
    }
    return out;
  },
};

const combatLockExtractor: EffectExtractor = {
  id: "prevent_combat",
  extract(_card, text) {
    return rule(String.raw`\benchanted creature can't attack or block\b`).test(text)
      ? [{ kind: "prevent_combat" }]
      : [];
  },
};

const bounceExtractor: EffectExtractor = {
  id: "bounce",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    const targetMatch = text.match(
      rule(
        String.raw`\breturn (up to one )?target (nonland permanent|creature|permanent)(?! you control)[^.]* to its owner's hand`,
      ),
    );
    if (targetMatch) {
      out.push({
        kind: "bounce",
        scope: "target",
        subject: parseSubject(targetMatch[2]),
        excludesYouControl: true,
      });
    }
    const allMatch = text.match(
      rule(
        String.raw`\breturn (all|each) (nonland )?(permanent|creature)s?\b(?! you control)[^.]* to (its|their) owners?'? hands?`,
      ),
    );
    if (allMatch) {
      out.push({
        kind: "bounce",
        scope: "all",
        subject: allMatch[2] ? "nonland_permanent" : parseSubject(allMatch[3]),
        excludesYouControl: true,
      });
    }
    return out;
  },
};

const fightExtractor: EffectExtractor = {
  id: "fight",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    if (rule(String.raw`\bfights? (up to one )?(another )?target creature`).test(text)) {
      out.push({ kind: "fight", scope: "target" });
    }
    if (
      rule(
        String.raw`\bfor each creature (your opponents control|an opponent controls)\b[^.]*?\bcreate\b[\s\S]*?\bfights?\b`,
      ).test(text)
    ) {
      out.push({ kind: "fight", scope: "token_per_opponent_creature" });
    }
    return out;
  },
};

const sacrificeWipeExtractor: EffectExtractor = {
  id: "sacrifice_all",
  extract(_card, text) {
    const match = text.match(
      rule(
        String.raw`\beach player sacrifices (?:all|each)[^.]*?\b(creatures|permanents|artifacts|enchantments)\b`,
      ),
    );
    return match ? [{ kind: "sacrifice_all", subject: parseSubject(match[1]) }] : [];
  },
};

const counterStackExtractor: EffectExtractor = {
  id: "counter_stack",
  extract(_card, text) {
    const match = text.match(
      rule(String.raw`\bcounter (up to one )?target\b[^.]*?\b(spell|ability)\b`),
    );
    if (!match) return [];
    const subject = match[2].toLowerCase() === "ability" ? "ability" : "spell";
    return [{ kind: "counter_stack", subject }];
  },
};

const protectionExtractor: EffectExtractor = {
  id: "protection",
  extract(_card, text) {
    const out: EffectPrimitive[] = [];
    if (
      rule(
        String.raw`\b(other )?(creatures|permanents) you control (gain|have) (hexproof|indestructible|protection|shroud)`,
      ).test(text)
    ) {
      out.push({ kind: "grant_protection", scope: "you_control" });
    }
    if (
      rule(
        String.raw`\btarget (creature|permanent|artifact|planeswalker)( or \w+)? you control gains (hexproof|indestructible|protection|shroud)`,
      ).test(text)
    ) {
      out.push({ kind: "grant_protection", scope: "target_you_control" });
    }
    if (
      rule(
        String.raw`\bequipped creature [^.]*?\b(hexproof|indestructible|shroud|protection from)`,
      ).test(text)
    ) {
      out.push({ kind: "grant_protection", scope: "equipped" });
    }
    if (rule(String.raw`\byou (have|gain) (hexproof|shroud|protection from)`).test(text)) {
      out.push({ kind: "grant_protection", scope: "you" });
    }
    if (rule(String.raw`\bphases? out\b`).test(text)) {
      out.push({ kind: "phase_out" });
    }
    return out;
  },
};

const EXTRACTORS: readonly EffectExtractor[] = [
  manaProductionExtractor,
  librarySearchExtractor,
  landDropExtractor,
  tokenCreationExtractor,
  drawExtractor,
  destroyExileExtractor,
  damageExtractor,
  ptModifyExtractor,
  combatLockExtractor,
  bounceExtractor,
  fightExtractor,
  sacrificeWipeExtractor,
  counterStackExtractor,
  protectionExtractor,
];

/** Every effect primitive one face's text has (reminder text left out). */
export function extractEffects(face: EffectFacts): EffectPrimitive[] {
  const cleanText = plainText(face.text);
  return EXTRACTORS.flatMap((extractor) => extractor.extract(face, cleanText));
}
