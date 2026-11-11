"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { commanderDetails } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { planText, reasonText, TAG_LABELS } from "../labels";

// Find a commander (design doc 36, section 9): one commander's cards on request, and starting a
// deck led by it.

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

export async function commanderCardsAction(
  oracleId: string,
  withReal: boolean,
): Promise<CommanderCardsView | null> {
  const actor = await requireActor();
  const details = await commanderDetails(getContainer().db, actor.userId, oracleId, withReal);
  if (details === null) return null;
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

/** A deck's name from a commander's: the front face, cut to the deck name limit. */
function deckName(commander: string): string {
  return commander.split(" // ")[0].slice(0, 60);
}

/** Start a Commander deck led by this card, and open it in the builder. */
export async function startDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const { decks } = getContainer();
  const name = String(formData.get("name") ?? "");
  const withReal = formData.get("real") === "1";
  const created = await decks.createDeck(actor, { name: deckName(name), format: "commander" });
  if (!created.ok) {
    const message =
      created.error.kind === "NameInvalid"
        ? "That name doesn't fit a deck name."
        : `You already have ${created.error.maximum} decks.`;
    redirect(`/decks/commanders?error=${encodeURIComponent(message)}`);
  }
  const deckId = created.value;
  await decks.importList(actor, { deckId, text: `Commander\n1 ${name}` });
  if (withReal) await decks.updateDeck(actor, { deckId, usesRealCards: true });
  revalidatePath("/decks");
  redirect(`/decks/${deckId}`);
}
