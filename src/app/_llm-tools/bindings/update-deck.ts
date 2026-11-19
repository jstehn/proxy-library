import { z } from "zod";
import { DeckId, FORMATS, type UpdateDeckError } from "@/modules/decks";
import { err, ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import type { ToolError } from "../tool";

const deckIdField = z.number().int().positive().describe("Deck id from list_decks.");

type Failure =
  | Readonly<{ kind: "InvalidInput"; message: string }>
  | Readonly<{ kind: "ConfirmationRequired" }>
  | UpdateDeckError;

export const updateDeckBinding = defineBinding({
  name: "update_deck",
  title: "Update deck metadata, profile, primer, or sources",
  description:
    "Updates a deck's name, format, targetBracket, profile fields (plan, landTarget, roleTargets, keyCards, avoid), primer section/body, research sources, or deletes the deck (deleteDeck + confirm).",
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId: deckIdField,
    name: z.string().min(1).max(60).optional().describe("New deck name."),
    // The old schema listed "other", which is no format (it would have been saved as one);
    // the deck formats are the one list.
    format: z.enum(FORMATS).optional().describe("New format."),
    targetBracket: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe("Commander bracket 1-5, or 0 to clear."),
    usesRealCards: z.boolean().optional().describe("Count real/paper cards as owned."),
    grouping: z
      .enum(["custom", "type"])
      .optional()
      .describe("Main deck grouping: 'custom' or 'type'."),
    plan: z.string().max(1000).optional().describe("Profile: 1-2 sentence deck plan."),
    landTarget: z.number().int().min(0).max(99).optional().describe("Profile: target land count."),
    roleTargets: z
      .object({
        ramp: z.number().int().min(0).max(99).optional().describe("Ramp target."),
        draw: z.number().int().min(0).max(99).optional().describe("Draw target."),
        removal: z.number().int().min(0).max(99).optional().describe("Removal target."),
        wipe: z.number().int().min(0).max(99).optional().describe("Wipe target."),
      })
      .optional()
      .describe("Profile: role targets."),
    keyCards: z
      .array(
        z.object({
          cardName: z.string().min(1).describe("Card name."),
          reason: z.string().max(200).default("").describe("Why it is a key card."),
        }),
      )
      .max(50)
      .optional()
      .describe("Profile: pinned key cards."),
    avoid: z
      .array(
        z.object({
          cardName: z.string().min(1).describe("Card name."),
          reason: z.string().max(200).default("").describe("Why to avoid it."),
        }),
      )
      .max(100)
      .optional()
      .describe("Profile: cards to avoid."),
    primerSection: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe("Primer ## heading to patch (omit to replace full primer)."),
    primerContent: z
      .string()
      .max(20000)
      .optional()
      .describe("Markdown content for primer or section ('' clears)."),
    sourceUrl: z.string().url().optional().describe("Research source URL to save."),
    sourceTitle: z.string().min(1).max(200).optional().describe("Research source title."),
    sourceUsedFor: z
      .string()
      .max(500)
      .optional()
      .describe("What the research source was used for."),
    deleteDeck: z
      .boolean()
      .optional()
      .describe("Set true with confirm=true to permanently delete the deck."),
    confirm: z.boolean().optional().describe("Confirmation flag required when deleteDeck=true."),
  }),
  async call(capabilities, actor, input) {
    const { deckId } = input;
    const { deckEdits, deckPlanEdits } = capabilities;

    if (input.deleteDeck) {
      if (!input.confirm) return err<Failure>({ kind: "ConfirmationRequired" });
      const deleted = await deckEdits.deleteDeck(actor, DeckId.of(deckId));
      return deleted.ok ? ok<Record<string, unknown>>({ deckId, deleted: true }) : deleted;
    }

    const results: Record<string, unknown> = { deckId };
    let didWork = false;

    if (
      input.name !== undefined ||
      input.format !== undefined ||
      input.targetBracket !== undefined ||
      input.usesRealCards !== undefined ||
      input.grouping !== undefined
    ) {
      didWork = true;
      const updated = await deckEdits.updateDeck(actor, {
        deckId: DeckId.of(deckId),
        name: input.name,
        format: input.format,
        usesRealCards: input.usesRealCards,
        // 0 clears it: a plain number keeps the schema simple for small models (rule 9).
        targetBracket: input.targetBracket === 0 ? null : input.targetBracket,
        grouping: input.grouping,
      });
      if (!updated.ok) return updated;
      results.metadataUpdated = true;
    }

    if (
      input.plan !== undefined ||
      input.landTarget !== undefined ||
      input.roleTargets !== undefined ||
      input.keyCards !== undefined ||
      input.avoid !== undefined
    ) {
      didWork = true;
      const profile = await deckPlanEdits.setProfile(actor, {
        deckId,
        patch: {
          ...(input.plan !== undefined ? { plan: input.plan } : {}),
          ...(input.landTarget !== undefined ? { landTarget: input.landTarget } : {}),
          ...(input.roleTargets !== undefined ? { roleTargets: input.roleTargets } : {}),
          ...(input.keyCards !== undefined ? { keyCards: input.keyCards } : {}),
          ...(input.avoid !== undefined ? { avoid: input.avoid } : {}),
        },
      });
      if (!profile.ok) return profile;
      results.profileUpdated = true;
    }

    if (input.primerContent !== undefined) {
      didWork = true;
      const primer = await deckPlanEdits.setPrimer(actor, {
        deckId,
        section: input.primerSection,
        content: input.primerContent,
      });
      if (!primer.ok) return primer;
      results.primerUpdated = true;
    }

    if (input.sourceUrl !== undefined) {
      didWork = true;
      const source = await deckPlanEdits.saveSource(actor, {
        deckId,
        url: input.sourceUrl,
        title: input.sourceTitle,
        usedFor: input.sourceUsedFor,
      });
      if (!source.ok) return source;
      results.sourceSaved = {
        deckId,
        source: source.value.source,
        totalCount: source.value.totalCount,
      };
    }

    if (!didWork) {
      return err<Failure>({
        kind: "InvalidInput",
        message: "Provide at least one field to update.",
      });
    }
    return ok(results);
  },
  present: (results) => results,
  describeError(failure, { input }): ToolError {
    switch (failure.kind) {
      case "InvalidInput":
        return failure;
      case "ConfirmationRequired":
        return {
          kind: "ConfirmationRequired",
          message: "Pass confirm: true to permanently delete this deck.",
        };
      case "DeckNotFound":
        return {
          kind: "DeckNotFound",
          message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
        };
      case "NameInvalid":
        return {
          kind: "NameInvalid",
          message: `Give the deck a name of up to ${failure.maximum} characters.`,
        };
      case "TargetBracketInvalid":
        return { kind: "TargetBracketInvalid", message: "A target bracket is 1, 2, 3, 4 or 5." };
      case "TargetBracketNotCommander":
        return {
          kind: "TargetBracketNotCommander",
          message:
            "Only Commander decks have a target bracket. Change the format to commander first, or leave targetBracket out.",
        };
    }
  },
});
