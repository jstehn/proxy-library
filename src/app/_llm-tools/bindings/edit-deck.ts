import { z } from "zod";
import {
  DeckId,
  MAX_HEADING_LENGTH,
  MAX_HEADINGS,
  type ApplyPreviewError,
  type ReplaceListError,
  type ReplaceReport,
  type SaveChangesError,
  type PreviewChangesError,
  type SavedChanges,
  type StoredPreviewResult,
} from "@/modules/decks";
import { err, ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import { presentChangePreview, presentPreviewWarnings } from "../present/deck-preview";
import type { ToolError } from "../tool";

const deckIdField = z.number().int().positive().describe("Deck id from list_decks.");

const HEADING_RULE = `A heading starts with a letter, has at most ${MAX_HEADING_LENGTH} characters, and isn't a board or card type name ("Sideboard", "Creatures"). A deck has at most ${MAX_HEADINGS}.`;

type Answer =
  | Readonly<{ kind: "replaced"; deckId: number; report: ReplaceReport }>
  | Readonly<{ kind: "previewed"; stored: StoredPreviewResult }>
  | Readonly<{ kind: "applied"; saved: SavedChanges }>
  | Readonly<{ kind: "saved"; saved: SavedChanges }>;

type Failure =
  | Readonly<{ kind: "InvalidInput"; message: string }>
  | ReplaceListError
  | PreviewChangesError
  | SaveChangesError
  | ApplyPreviewError;

export const editDeckBinding = defineBinding({
  name: "edit_deck",
  title: "Preview/apply deck changes or replace deck list",
  description:
    "Edit a deck's cards via batch `changes` (save=false previews and returns previewId; commit with { deckId, previewId, save: true } for a minimal ack, or pass changes + fingerprint + save: true in one step) OR replace the full `list` with `fingerprint` from get_deck.",
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId: deckIdField,
    changes: z
      .array(
        z.object({
          card: z.string().min(1).describe("Exact English card name or id."),
          quantity: z
            .number()
            .int()
            .min(0)
            .max(100)
            .optional()
            .describe("Target quantity (0 removes)."),
          board: z.enum(["main", "side", "commander", "maybe"]).default("main").describe("Board."),
          note: z.string().max(400).optional().describe("Card note."),
          heading: z.string().max(200).optional().describe("Custom heading."),
          tags: z.array(z.string().min(1).max(40)).max(20).optional().describe("Tags."),
          role: z.string().max(120).optional().describe("One-line role."),
          pinned: z.boolean().optional().describe("Pin card."),
        }),
      )
      .min(1)
      .max(100)
      .optional()
      .describe("Batch changes to preview or save."),
    save: z.boolean().default(false).describe("False previews changes; true saves them."),
    previewId: z.string().min(1).optional().describe("Preview id from a prior edit_deck preview."),
    list: z.string().min(1).optional().describe("Full deck list text (for full replacement)."),
    fingerprint: z.string().min(1).optional().describe("Deck fingerprint from get_deck."),
    unnamedPrinting: z
      .enum(["cheapest", "standard"])
      .default("cheapest")
      .describe("Printing choice for unowned lines without a set code."),
  }),
  async call(capabilities, actor, input) {
    const { deckId } = input;
    if (input.list !== undefined) {
      if (!input.fingerprint) {
        return err<Failure>({
          kind: "InvalidInput",
          message: "Provide `fingerprint` from get_deck when replacing `list`.",
        });
      }
      const replaced = await capabilities.deckEdits.replaceList(actor, {
        deckId: DeckId.of(deckId),
        text: input.list,
        fingerprint: input.fingerprint,
        unnamedPrinting: input.unnamedPrinting,
      });
      return replaced.ok
        ? ok<Answer>({ kind: "replaced", deckId, report: replaced.value })
        : replaced;
    }

    const changes = input.changes ?? [];
    if (input.save && input.previewId && changes.length === 0) {
      const applied = await capabilities.deckPreviews.applyPreview(actor, {
        deckId,
        previewId: input.previewId,
        fingerprint: input.fingerprint,
      });
      return applied.ok ? ok<Answer>({ kind: "applied", saved: applied.value }) : applied;
    }
    if (changes.length === 0) {
      return err<Failure>({
        kind: "InvalidInput",
        message: "Pass changes (or a previewId with save: true).",
      });
    }
    if (!input.save) {
      const previewed = await capabilities.deckPreviews.previewChanges(actor, { deckId, changes });
      return previewed.ok ? ok<Answer>({ kind: "previewed", stored: previewed.value }) : previewed;
    }
    if (!input.fingerprint) {
      return err<Failure>({
        kind: "InvalidInput",
        message:
          "Pass the fingerprint from get_deck or a prior preview (or previewId) when save is true.",
      });
    }
    const saved = await capabilities.deckPreviews.saveChanges(actor, {
      deckId,
      changes,
      fingerprint: input.fingerprint,
    });
    return saved.ok ? ok<Answer>({ kind: "saved", saved: saved.value }) : saved;
  },
  present(answer) {
    if (answer.kind === "replaced") {
      return { deckId: answer.deckId, cards: answer.report.cards };
    }
    if (answer.kind === "previewed") {
      const { preview, warnings, previewId } = answer.stored;
      return {
        ...presentChangePreview(preview, { saved: false, fingerprint: preview.fingerprint }),
        ...(warnings.length > 0 ? { warnings: presentPreviewWarnings(warnings) } : {}),
        previewId,
      };
    }
    if (answer.kind === "applied") {
      const { preview, warnings, fingerprint } = answer.saved;
      return {
        saved: true,
        deckId: preview.deck.id,
        fingerprint,
        cardCount: preview.after.stats.cardCount,
        shortTotal: preview.after.shortTotal,
        ...(warnings.length > 0 ? { warnings: presentPreviewWarnings(warnings) } : {}),
      };
    }
    const { preview, warnings, fingerprint } = answer.saved;
    return {
      ...presentChangePreview(preview, { saved: true, fingerprint }),
      ...(warnings.length > 0 ? { warnings: presentPreviewWarnings(warnings) } : {}),
    };
  },
  describeError(failure, { input }): ToolError {
    const replacing = input.list !== undefined;
    switch (failure.kind) {
      case "InvalidInput":
        return failure;
      case "DeckNotFound":
        return {
          kind: "DeckNotFound",
          message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
        };
      case "DeckChanged":
        if (replacing) {
          return {
            kind: "DeckChanged",
            message:
              "The deck changed since your get_deck. Call get_deck again, redo the edit on its new list, and send its new fingerprint.",
          };
        }
        return {
          kind: "DeckChanged",
          message:
            input.previewId !== undefined && (input.changes ?? []).length === 0
              ? "The deck changed since that preview. Preview again without saving."
              : "The deck changed since that fingerprint. Preview again without saving to get the new fingerprint.",
        };
      case "ListTooLong":
        return {
          kind: "ListTooLong",
          message: `A list may have up to ${failure.maximumLines} lines.`,
        };
      case "ListProblems":
        return {
          kind: "ListProblems",
          message: `Nothing was saved. Unreadable lines: ${JSON.stringify(failure.unreadable)}. Cards not found: ${JSON.stringify(failure.notFound)}.`,
        };
      case "PreviewExpired":
        return {
          kind: "PreviewExpired",
          message: "That previewId is missing or expired. Preview the changes again.",
        };
      case "CardsNotFound":
        return {
          kind: "CardNotFound",
          message: `Cards not in the catalog (nothing previewed or saved): ${failure.names.join(", ")}.`,
        };
      case "ChangeNoteInvalid":
        return {
          kind: "NoteInvalid",
          message: `Line note for ${failure.card} must be 1 to ${failure.maximum} characters (or "" to clear).`,
        };
      case "LineNotOnBoard":
        return {
          kind: "QuantityInvalid",
          message: `${failure.card} is not on the ${failure.board} board; pass quantity to add it.`,
        };
      case "QuantityInvalid":
        return { kind: "QuantityInvalid", message: `Use 0 to ${failure.maximum} copies.` };
      case "CardNotFound":
        return {
          kind: "CardNotFound",
          message: `No card named "one of the changed cards" in this catalog. Check the spelling, or find it with search_cards.`,
        };
      case "NoteInvalid":
        return {
          kind: "NoteInvalid",
          message: `Line notes must be 1 to ${failure.maximum} characters (or "" to clear).`,
        };
      case "HeadingInvalid":
        return { kind: "HeadingInvalid", message: HEADING_RULE };
    }
  },
});
