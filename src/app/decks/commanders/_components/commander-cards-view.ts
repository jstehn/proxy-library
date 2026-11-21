import type { Reads } from "@/server/reads";
import { planText, reasonText, TAG_LABELS } from "../../labels";

// One commander's cards as the "See the cards" panel shows them: the words are chosen here, so
// the panel only lays them out.

/** What the read returns for a commander that can lead a deck. */
type CommanderDetails = NonNullable<Awaited<ReturnType<Reads["decks"]["commanderDetails"]>>>;

/** One commander's cards, as the page shows them. */
export type CommanderCardsView = Readonly<{
  plan: string;
  onPlan: ReadonlyArray<Readonly<{ name: string; reasons: string }>>;
  roles: ReadonlyArray<
    Readonly<{ label: string; have: number; target: number; names: readonly string[] }>
  >;
  missing: Readonly<{
    picks: ReadonlyArray<Readonly<{ name: string; fills: string; priceCents: number | null }>>;
    totalCents: number;
  }>;
}>;

/** How many names each list shows. */
const SHOWN = 40;

export function commanderCardsView(details: CommanderDetails): CommanderCardsView {
  return {
    plan: planText(details.coverage.plan),
    onPlan: details.onPlan.slice(0, SHOWN).map((entry) => ({
      name: entry.card.name,
      reasons: entry.reasons.map(reasonText).join(" · "),
    })),
    roles: details.coverage.roles.map((role) => ({
      label: TAG_LABELS[role.tag],
      have: role.have,
      target: role.target,
      names: details.byRole[role.tag].slice(0, SHOWN).map((card) => card.name),
    })),
    missing: {
      picks: details.missing.picks.map((pick) => ({
        name: pick.card.name,
        fills: pick.fills === "plan" ? "on-plan" : TAG_LABELS[pick.fills],
        priceCents: pick.card.priceCents,
      })),
      totalCents: details.missing.totalCents,
    },
  };
}
