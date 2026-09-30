import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import type {
  Forbidden,
  ImageNotFound,
  PhotoNotOnPage,
  ProductNotFound,
  SetNotFound,
  SlugInvalid,
  SyncAlreadyQueued,
} from "../domain/errors";
import { companionsToEnable } from "../domain/rules";
import type { PrintingId, SetCode } from "../domain/types";
import type { ArtworkSize } from "../domain/wpn";
import type {
  AdminPhotoChoice,
  CatalogDependencies,
  ImageFace,
  ImageSize,
  ImageSource,
  SyncKind,
  SyncRunRepository,
} from "./ports";

export type RequestSyncError = Forbidden | SyncAlreadyQueued;
export type SetSetEnabledError = Forbidden | SetNotFound;
export type ChoosePhotoError = Forbidden | ProductNotFound | PhotoNotOnPage;
export type SetPageSlugError = Forbidden | SetNotFound | SlugInvalid;

/** A WPN page slug an admin may type: lowercase words joined by hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Admin actions on the catalog, and serving card images. */
export function makeCatalogAdmin(dependencies: CatalogDependencies) {
  const { unitOfWork, clock, images, imageFetcher, artworkFiles } = dependencies;

  /** "Sync now": puts a run in the queue for the worker (design doc 04, section 5). */
  async function requestSync(
    actor: Actor,
    kind: SyncKind,
  ): Promise<Result<void, RequestSyncError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    return unitOfWork.run<void, RequestSyncError>(async ({ syncRuns }) => {
      if (await syncRuns.hasPending()) return err({ kind: "SyncAlreadyQueued" });
      await syncRuns.queue({ kind, requestedBy: actor.userId, requestedAt: clock.now() });
      return ok();
    });
  }

  /** Enables or disables one set. Enabling queues a sync so the set gets imported. */
  async function setSetEnabled(
    actor: Actor,
    input: { code: SetCode; enabled: boolean },
  ): Promise<Result<void, SetSetEnabledError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    return unitOfWork.run<void, SetSetEnabledError>(async ({ catalog, syncRuns }) => {
      const states = await catalog.setStates();
      const state = states.find((s) => s.code === input.code);
      if (state === undefined) return err({ kind: "SetNotFound" });

      await catalog.setEnabled([input.code], input.enabled);
      // Rule 11: enabling a set also enables its Commander companion set (its precons).
      const companions = input.enabled ? companionsToEnable(await catalog.setStates()) : [];
      await catalog.setEnabled(companions, true);
      const needsImport =
        input.enabled && (state.importedVersion === null || companions.length > 0);
      if (needsImport && !(await syncRuns.hasPending())) {
        await syncRuns.queue({
          kind: "prices",
          requestedBy: actor.userId,
          requestedAt: clock.now(),
        });
      }
      return ok();
    });
  }

  /** Enables every current Standard set that isn't enabled yet. Never disables any. */
  async function enableStandardSets(actor: Actor): Promise<Result<SetCode[], Forbidden>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    return unitOfWork.run<SetCode[], Forbidden>(async ({ catalog, syncRuns }) => {
      const standard = new Set(await catalog.standardSetCodes());
      const toEnable = (await catalog.setStates())
        .filter((state) => standard.has(state.code) && !state.isEnabled)
        .map((state) => state.code);
      if (toEnable.length > 0) {
        await catalog.setEnabled(toEnable, true);
        await catalog.setEnabled(companionsToEnable(await catalog.setStates()), true);
        if (!(await syncRuns.hasPending())) {
          await syncRuns.queue({
            kind: "prices",
            requestedBy: actor.userId,
            requestedAt: clock.now(),
          });
        }
      }
      return ok(toEnable);
    });
  }

  /**
   * A card image: from our disk cache, or fetched from Scryfall once and saved (rule 10).
   */
  async function imageFor(input: {
    printingId: PrintingId;
    size: ImageSize;
    face: ImageFace;
  }): Promise<Result<Uint8Array, ImageNotFound>> {
    const source = await unitOfWork.run<ImageSource | null, never>(async ({ catalog }) =>
      ok(await catalog.imageSource(input.printingId)),
    );
    if (!source.ok || source.value === null) return err({ kind: "ImageNotFound" });

    const faceUris =
      input.face === "front" ? source.value.images?.front : source.value.images?.back;
    if (faceUris === undefined || faceUris === null) return err({ kind: "ImageNotFound" });

    const key = { size: input.size, scryfallId: source.value.scryfallId, face: input.face };
    const cached = await images.get(key);
    if (cached !== null) return ok(cached);

    const bytes = await imageFetcher.fetch(faceUris[input.size]);
    await images.put(key, bytes);
    return ok(bytes);
  }

  /**
   * An admin picks a product's WPN product and photo, or none (design doc 13, rule 5). Later
   * syncs keep the choice until it's undone.
   */
  async function choosePhoto(
    actor: Actor,
    choice: AdminPhotoChoice,
  ): Promise<Result<void, ChoosePhotoError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    return unitOfWork.run<void, ChoosePhotoError>(async ({ artwork }) => {
      const options = await artwork.photoOptions(choice.productId);
      if (options === null) return err({ kind: "ProductNotFound" });
      if (choice.wpnName !== null) {
        const option = options.find((candidate) => candidate.name === choice.wpnName);
        const photoFits =
          choice.photoIndex === null ||
          (Number.isInteger(choice.photoIndex) &&
            choice.photoIndex >= 0 &&
            choice.photoIndex < (option?.imageCount ?? 0));
        if (option === undefined || !photoFits) return err({ kind: "PhotoNotOnPage" });
      } else if (choice.photoIndex !== null) {
        return err({ kind: "PhotoNotOnPage" });
      }
      await artwork.saveAdminChoice(choice);
      return ok();
    });
  }

  /**
   * Undoes an admin's choice. The product's set's page is read again on the next sync, which
   * links the product automatically (it's queued now).
   */
  async function clearPhotoChoice(
    actor: Actor,
    productId: string,
  ): Promise<Result<void, Forbidden>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    return unitOfWork.run<void, Forbidden>(async ({ artwork, syncRuns }) => {
      const pageSet = await artwork.clearAdminChoice(productId);
      if (pageSet !== null) {
        await artwork.savePageProblem(pageSet, "no_page", "waiting to be read again", new Date(0));
        await queueSyncUnlessPending(syncRuns, actor);
      }
      return ok();
    });
  }

  /**
   * Sets which WPN page a set uses, for a set whose name doesn't lead to it (null goes back to
   * the automatic ones). Queues a sync so the page is read.
   */
  async function setPageSlug(
    actor: Actor,
    input: { setCode: SetCode; slug: string | null },
  ): Promise<Result<void, SetPageSlugError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    const slug = input.slug?.trim().toLowerCase() || null;
    if (slug !== null && (!SLUG.test(slug) || slug.length > 120)) {
      return err({ kind: "SlugInvalid" });
    }
    return unitOfWork.run<void, SetPageSlugError>(async ({ catalog, artwork, syncRuns }) => {
      const states = await catalog.setStates();
      if (!states.some((state) => state.code === input.setCode)) {
        return err({ kind: "SetNotFound" });
      }
      await artwork.setSlugOverride(input.setCode, slug);
      await artwork.savePageProblem(input.setCode, "no_page", "waiting to be read", new Date(0));
      await queueSyncUnlessPending(syncRuns, actor);
      return ok();
    });
  }

  /** Queues a prices sync (which reads pages marked to be read again), unless one is waiting. */
  async function queueSyncUnlessPending(syncRuns: SyncRunRepository, actor: Actor): Promise<void> {
    if (!(await syncRuns.hasPending())) {
      await syncRuns.queue({ kind: "prices", requestedBy: actor.userId, requestedAt: clock.now() });
    }
  }

  /** A downloaded product photo or key art, from disk (never fetched on demand: rule 3). */
  async function artworkFor(input: {
    imageId: string;
    size: ArtworkSize;
  }): Promise<Result<Uint8Array, ImageNotFound>> {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(input.imageId)) return err({ kind: "ImageNotFound" });
    const bytes = await artworkFiles.get(input.imageId, input.size);
    return bytes === null ? err({ kind: "ImageNotFound" }) : ok(bytes);
  }

  return {
    requestSync,
    setSetEnabled,
    enableStandardSets,
    imageFor,
    choosePhoto,
    clearPhotoChoice,
    setPageSlug,
    artworkFor,
  };
}
