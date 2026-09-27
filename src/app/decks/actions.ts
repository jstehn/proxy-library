"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import { BOARDS, DeckId, FORMATS } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

// Server actions for the deck screens. Errors come back as ?error=… on the page they came from.

function deckPath(deckId: number, error?: string): string {
  return error === undefined
    ? `/decks/${deckId}`
    : `/decks/${deckId}?error=${encodeURIComponent(error)}`;
}

export async function createDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const format = z.enum(FORMATS).catch("casual").parse(formData.get("format"));
  const result = await getContainer().decks.createDeck(actor, {
    name: String(formData.get("name") ?? ""),
    format,
  });
  if (!result.ok) {
    const message =
      result.error.kind === "NameInvalid"
        ? `Give the deck a name of up to ${result.error.maximum} characters.`
        : `You already have ${result.error.maximum} decks.`;
    redirect(`/decks?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/decks");
  redirect(deckPath(result.value));
}

const EntryForm = z.object({
  deckId: z.coerce.number().int().positive(),
  oracleId: z.string().min(1),
  board: z.enum(BOARDS),
  quantity: z.coerce.number().int(),
  printingId: z.string().optional(),
  finish: z.enum(["nonfoil", "foil", "etched"]).optional(),
});

export async function setEntryAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const form = EntryForm.safeParse(Object.fromEntries(formData));
  if (!form.success) redirect("/decks");
  const { deckId, oracleId, board, quantity, printingId, finish } = form.data;
  const result = await getContainer().decks.setEntry(actor, {
    deckId: DeckId.of(deckId),
    oracleId,
    board,
    quantity: Math.max(0, quantity),
    printingId: printingId ? PrintingId.of(printingId) : undefined,
    finish,
  });
  if (!result.ok) {
    if (result.error.kind === "DeckNotFound") redirect("/decks");
    redirect(
      deckPath(
        deckId,
        result.error.kind === "QuantityInvalid"
          ? "At most 99 copies."
          : "That card isn't in the catalog.",
      ),
    );
  }
  revalidatePath(deckPath(deckId));
  redirect(
    `${deckPath(deckId)}${formData.get("q") ? `?q=${encodeURIComponent(String(formData.get("q")))}` : ""}`,
  );
}

export async function updateDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const format = z.enum(FORMATS).parse(formData.get("format"));
  const result = await getContainer().decks.updateDeck(actor, {
    deckId: DeckId.of(deckId),
    name: String(formData.get("name") ?? ""),
    format,
  });
  if (!result.ok)
    redirect(
      result.error.kind === "DeckNotFound"
        ? "/decks"
        : deckPath(deckId, "Give the deck a name of up to 60 characters."),
    );
  revalidatePath(deckPath(deckId));
  redirect(deckPath(deckId));
}

export async function deleteDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await getContainer().decks.deleteDeck(actor, DeckId.of(Number(formData.get("deckId"))));
  revalidatePath("/decks");
  redirect("/decks");
}

export async function importListAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const result = await getContainer().decks.importList(actor, {
    deckId: DeckId.of(deckId),
    text: String(formData.get("list") ?? ""),
  });
  if (!result.ok) redirect("/decks");
  const { added, unreadable, notFound } = result.value;
  const parts = [`Added ${added} cards.`];
  if (notFound.length > 0) parts.push(`Not in the catalog: ${notFound.join(", ")}.`);
  if (unreadable.length > 0) parts.push(`Couldn't read: ${unreadable.join(" | ")}.`);
  revalidatePath(deckPath(deckId));
  redirect(`${deckPath(deckId)}?imported=${encodeURIComponent(parts.join(" "))}`);
}
