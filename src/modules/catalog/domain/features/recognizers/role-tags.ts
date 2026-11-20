// Role tags (design doc 19, section 3): the job a card does in a deck, composed from effect
// primitives (./effects). Rules as data: one row per tag, matching structured EffectPrimitives
// instead of card-shaped one-off regexes. Moved from shared/card-search/tags.ts.
import { cardTypes, type Tag } from "@/shared/kernel";
import type { Recognizer } from "../types";
import { extractEffects, type EffectPrimitive } from "./effects";

type TagRule = Readonly<{
  tag: Tag;
  /** The card has the tag if any extracted effect primitive satisfies this predicate. */
  matches: (effects: readonly EffectPrimitive[]) => boolean;
  /** Lands never get this tag: a land that taps for mana is a land, not ramp. */
  notOnLands?: boolean;
}>;

const TAG_RULES: readonly TagRule[] = [
  {
    tag: "ramp",
    notOnLands: true,
    matches: (effects) =>
      effects.some(
        (e) =>
          e.kind === "mana_production" ||
          (e.kind === "search_library" && e.subject === "land" && e.toZone === "battlefield") ||
          e.kind === "extra_land_play" ||
          e.kind === "put_land_from_hand" ||
          (e.kind === "create_token" && e.tokenKind === "treasure"),
      ),
  },
  {
    tag: "draw",
    matches: (effects) => effects.some((e) => e.kind === "draw_cards" && !e.conditional),
  },
  {
    tag: "removal",
    matches: (effects) =>
      effects.some(
        (e) =>
          (e.kind === "destroy_or_exile" &&
            e.scope === "target" &&
            e.excludesYouControl &&
            !e.fromGraveyard &&
            e.subject !== "land") ||
          (e.kind === "damage" &&
            e.scope === "target" &&
            (e.subject === "any_target" ||
              e.subject === "creature" ||
              e.subject === "planeswalker" ||
              e.subject === "battle")) ||
          (e.kind === "fight" && e.scope === "target") ||
          (e.kind === "modify_pt" && e.scope === "target" && e.negative) ||
          e.kind === "prevent_combat" ||
          (e.kind === "bounce" && e.scope === "target" && e.excludesYouControl),
      ),
  },
  {
    tag: "wipe",
    matches: (effects) =>
      effects.some(
        (e) =>
          (e.kind === "destroy_or_exile" &&
            e.scope === "all" &&
            e.excludesYouControl &&
            e.subject !== "land") ||
          (e.kind === "damage" && e.scope === "all" && e.excludesYouControl) ||
          (e.kind === "modify_pt" &&
            (e.scope === "all" || e.scope === "opponents") &&
            e.negative) ||
          (e.kind === "bounce" && e.scope === "all" && e.excludesYouControl) ||
          (e.kind === "fight" && e.scope === "token_per_opponent_creature") ||
          e.kind === "sacrifice_all",
      ),
  },
  {
    tag: "counter",
    matches: (effects) => effects.some((e) => e.kind === "counter_stack"),
  },
  {
    tag: "tutor",
    matches: (effects) =>
      effects.some((e) => e.kind === "search_library" && e.subject === "card" && !e.namedOnly),
  },
  {
    tag: "protection",
    matches: (effects) =>
      effects.some((e) => e.kind === "grant_protection" || e.kind === "phase_out"),
  },
];

export const roleTags: Recognizer<"roleTags"> = {
  id: "role-tags",
  field: "roleTags",
  recognize(card) {
    // The front face: a spell with a land on its back is still tagged as the spell it is played as.
    const isLand = cardTypes(card.faces.map((face) => face.typeLine).join(" // ")).isLandOnFront;
    const effects = card.faces.flatMap((face) =>
      extractEffects({ text: face.text, producedMana: card.producedMana }),
    );
    return TAG_RULES.filter((row) => !(row.notOnLands && isLand) && row.matches(effects)).map(
      (row) => row.tag,
    );
  },
};
