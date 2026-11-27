import type { Actor } from "@/modules/accounts";
import { err, ok, type Clock, type Result, type UserId } from "@/shared/kernel";
import { isPlayed } from "@/modules/decks/core/client";
import type { Board } from "@/modules/decks/core/client";
import { isAvoidCard, isKeyCard, type DeckPlan } from "@/modules/decks/core/client";
import type { DeckView } from "@/modules/decks/core/client";
import type {
  DeckChanged,
  DeckNotFound,
  HeadingInvalid,
  NoteInvalid,
} from "@/modules/decks/core/client";
import { checkNote } from "@/modules/decks/core/client";
import type { DeckChange, DeckChangePreview } from "../domain/preview";
import type { PreviewCastCurves } from "../domain/cast-curve-delta";
import type { ApplyChangesError, ApplyChangesReport } from "@/modules/decks/core";
import type { ChangeToSave, PreviewRepository } from "./ports";

// Dry-run changes (design doc 40, ADR 0026). A preview evaluates a batch of card changes without
// saving; the saved preview lets the player (or the model) commit exactly those changes later,
// and only if the deck is unchanged. Previews live in a table, so they survive a restart.

/** How long a preview can be applied after it was made. */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

/** One change as the player or model wrote it: the card by name, the line by board. */
export type ChangeRequest = Readonly<{
  card: string;
  board: Board;
  /** The count on this board (0 removes). Left out: keep the line's count. */
  quantity?: number;
  /** "" clears each of these four; left out keeps them. */
  note?: string;
  heading?: string;
  role?: string;
  tags?: readonly string[];
  pinned?: boolean;
}>;

/** A change that touches a key card or an avoid card of the deck's profile. */
export type PreviewWarning =
  | Readonly<{
      kind: "KeyCardCut";
      card: string;
      board: Board;
      before: number;
      after: number;
      pinned: boolean;
      reason: string | null;
    }>
  | Readonly<{ kind: "AvoidCardAdded"; card: string; reason: string | null }>;

export type CardsNotFound = Readonly<{ kind: "CardsNotFound"; names: readonly string[] }>;
export type ChangeNoteInvalid = Readonly<{
  kind: "ChangeNoteInvalid";
  card: string;
  maximum: number;
}>;
/** A change without a quantity names a line the deck doesn't have. */
export type LineNotOnBoard = Readonly<{ kind: "LineNotOnBoard"; card: string; board: Board }>;
export type PreviewExpired = Readonly<{ kind: "PreviewExpired" }>;

export type PreviewChangesError = DeckNotFound | CardsNotFound | ChangeNoteInvalid | LineNotOnBoard;
export type SaveChangesError = PreviewChangesError | ApplyChangesError;
export type ApplyPreviewError = DeckNotFound | PreviewExpired | DeckChanged | ApplyChangesError;
export type { DeckChanged, HeadingInvalid, NoteInvalid };

export type PreviewedChanges = Readonly<{
  preview: DeckChangePreview;
  warnings: readonly PreviewWarning[];
}>;

/** `castCurves` is null when it was not asked for or could not be made (design doc 72). */
export type StoredPreviewResult = PreviewedChanges &
  Readonly<{ previewId: string; castCurves: PreviewCastCurves | null }>;
export type SavedChanges = PreviewedChanges & Readonly<{ fingerprint: string }>;

export type DeckPreviewDependencies = Readonly<{
  previews: PreviewRepository;
  clock: Clock;
  newPreviewId: () => string;
  /** The oracle id of each name the catalog knows; unknown names are left out. */
  findCards(names: readonly string[]): Promise<Map<string, string>>;
  deckView(userId: UserId, deckId: number): Promise<DeckView | null>;
  /** The dry run itself: the deck before and after, or null when it isn't the player's. */
  changePreview(
    userId: UserId,
    deckId: number,
    changes: readonly DeckChange[],
  ): Promise<DeckChangePreview | null>;
  /** The cast-by-turn curves before and after the changes, or null when they can't be made. */
  castCurves(
    userId: UserId,
    deckId: number,
    changes: readonly DeckChange[],
  ): Promise<PreviewCastCurves | null>;
  profile(userId: UserId, deckId: number): Promise<DeckPlan | null>;
  applyChanges(
    actor: Actor,
    input: Readonly<{ deckId: number; fingerprint: string; changes: readonly ChangeToSave[] }>,
  ): Promise<Result<ApplyChangesReport, ApplyChangesError>>;
}>;

type Evaluated = PreviewedChanges &
  Readonly<{ changesToSave: readonly ChangeToSave[]; dryRun: readonly DeckChange[] }>;

function warningsFor(
  view: DeckView | null,
  profile: DeckPlan | null,
  preview: DeckChangePreview,
): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];
  for (const change of preview.changes) {
    if (!isPlayed(change.board)) continue;
    const lowerName = change.name.toLowerCase();
    const line = view?.lines.find(
      (candidate) => candidate.name.toLowerCase() === lowerName && candidate.board === change.board,
    );
    const pinned = line?.pinned === true;
    if (change.afterQuantity < change.beforeQuantity && isKeyCard(change.name, profile, pinned)) {
      warnings.push({
        kind: "KeyCardCut",
        card: change.name,
        board: change.board,
        before: change.beforeQuantity,
        after: change.afterQuantity,
        pinned,
        reason:
          profile?.keyCards.find((k) => k.cardName.toLowerCase() === lowerName)?.reason ?? null,
      });
    }
    if (change.afterQuantity > change.beforeQuantity && isAvoidCard(change.name, profile)) {
      warnings.push({
        kind: "AvoidCardAdded",
        card: change.name,
        reason: profile?.avoid.find((a) => a.cardName.toLowerCase() === lowerName)?.reason ?? null,
      });
    }
  }
  return warnings;
}

export function makeDeckPreviews(dependencies: DeckPreviewDependencies) {
  const { previews, clock, newPreviewId } = dependencies;

  /** Turns names into cards and fills in counts, then dry-runs. Nothing is stored or saved. */
  async function evaluate(
    actor: Actor,
    deckId: number,
    changes: readonly ChangeRequest[],
  ): Promise<Result<Evaluated, PreviewChangesError>> {
    const names = [...new Set(changes.map((change) => change.card))];
    const found = await dependencies.findCards(names);
    const missing = names.filter((name) => !found.has(name));
    if (missing.length > 0) return err({ kind: "CardsNotFound", names: missing });

    for (const change of changes) {
      if ((change.quantity ?? 1) > 0 && change.note !== undefined && change.note !== "") {
        const checked = checkNote(change.note);
        if (!checked.ok) {
          return err({
            kind: "ChangeNoteInvalid",
            card: change.card,
            maximum: checked.error.maximum,
          });
        }
      }
    }

    const needsView = changes.some((change) => change.quantity === undefined);
    const view = await dependencies.deckView(actor.userId, deckId);
    if (needsView && view === null) return err({ kind: "DeckNotFound" });

    const dryRun: DeckChange[] = [];
    const changesToSave: ChangeToSave[] = [];
    for (const change of changes) {
      const oracleId = found.get(change.card);
      if (oracleId === undefined) continue;
      let quantity = change.quantity;
      if (quantity === undefined) {
        const line = view?.lines.find(
          (candidate) => candidate.oracleId === oracleId && candidate.board === change.board,
        );
        if (line === undefined) {
          return err({ kind: "LineNotOnBoard", card: change.card, board: change.board });
        }
        quantity = line.quantity;
      }
      dryRun.push({ oracleId, board: change.board, quantity });
      const keeps = quantity > 0;
      changesToSave.push({
        oracleId,
        board: change.board,
        quantity,
        ...(change.note !== undefined && keeps
          ? { note: change.note === "" ? null : change.note }
          : {}),
        ...(change.heading !== undefined && keeps
          ? { heading: change.heading === "" ? null : change.heading }
          : {}),
        ...(change.tags !== undefined && keeps ? { tags: change.tags } : {}),
        ...(change.role !== undefined && keeps
          ? { role: change.role === "" ? null : change.role }
          : {}),
        ...(change.pinned !== undefined && keeps ? { pinned: change.pinned } : {}),
      });
    }

    const preview = await dependencies.changePreview(actor.userId, deckId, dryRun);
    if (preview === null) return err({ kind: "DeckNotFound" });
    const profile = await dependencies.profile(actor.userId, deckId);
    return ok({
      preview,
      warnings: warningsFor(view, profile, preview),
      changesToSave,
      dryRun,
    });
  }

  /** Dry-runs a batch and stores it, so `applyPreview` can commit exactly these changes. */
  async function previewChanges(
    actor: Actor,
    input: Readonly<{ deckId: number; changes: readonly ChangeRequest[]; curves?: boolean }>,
  ): Promise<Result<StoredPreviewResult, PreviewChangesError>> {
    const evaluated = await evaluate(actor, input.deckId, input.changes);
    if (!evaluated.ok) return evaluated;
    // A simulation that fails or throws never fails the preview (design doc 72, invariant 5).
    const castCurves =
      input.curves === false
        ? null
        : await dependencies
            .castCurves(actor.userId, input.deckId, evaluated.value.dryRun)
            .catch(() => null);
    const now = clock.now();
    const previewId = newPreviewId();
    await previews.prune(now);
    await previews.store({
      id: previewId,
      userId: actor.userId,
      deckId: input.deckId,
      fingerprint: evaluated.value.preview.fingerprint,
      changes: evaluated.value.changesToSave,
      expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
    });
    return ok({
      previewId,
      preview: evaluated.value.preview,
      warnings: evaluated.value.warnings,
      castCurves,
    });
  }

  /** Dry-runs a batch and saves it at once, if the deck still has the fingerprint. */
  async function saveChanges(
    actor: Actor,
    input: Readonly<{ deckId: number; changes: readonly ChangeRequest[]; fingerprint: string }>,
  ): Promise<Result<SavedChanges, SaveChangesError>> {
    const evaluated = await evaluate(actor, input.deckId, input.changes);
    if (!evaluated.ok) return evaluated;
    const saved = await dependencies.applyChanges(actor, {
      deckId: input.deckId,
      fingerprint: input.fingerprint,
      changes: evaluated.value.changesToSave,
    });
    if (!saved.ok) return saved;
    return ok({
      preview: evaluated.value.preview,
      warnings: evaluated.value.warnings,
      fingerprint: saved.value.fingerprint,
    });
  }

  /** Saves what an earlier preview showed, if the deck is as it was and the preview is fresh. */
  async function applyPreview(
    actor: Actor,
    input: Readonly<{ deckId: number; previewId: string; fingerprint?: string }>,
  ): Promise<Result<SavedChanges, ApplyPreviewError>> {
    const now = clock.now();
    const stored = await previews.find(input.previewId, actor.userId, now);
    if (stored === null || stored.deckId !== input.deckId) return err({ kind: "PreviewExpired" });
    const preview = await dependencies.changePreview(
      actor.userId,
      input.deckId,
      stored.changes.map((change) => ({
        oracleId: change.oracleId,
        board: change.board,
        quantity: change.quantity,
      })),
    );
    if (preview === null) return err({ kind: "DeckNotFound" });
    const saved = await dependencies.applyChanges(actor, {
      deckId: input.deckId,
      fingerprint: input.fingerprint ?? stored.fingerprint,
      changes: stored.changes,
    });
    if (!saved.ok) return saved;
    await previews.delete(input.previewId);
    return ok({ preview, warnings: [], fingerprint: saved.value.fingerprint });
  }

  return { previewChanges, saveChanges, applyPreview };
}
