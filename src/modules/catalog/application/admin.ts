import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import type { Forbidden, ImageNotFound, SetNotFound, SyncAlreadyQueued } from "../domain/errors";
import type { PrintingId, SetCode } from "../domain/types";
import type { CatalogDependencies, ImageFace, ImageSize, ImageSource, SyncKind } from "./ports";

export type RequestSyncError = Forbidden | SyncAlreadyQueued;
export type SetSetEnabledError = Forbidden | SetNotFound;

/** Admin actions on the catalog, and serving card images. */
export function makeCatalogAdmin(dependencies: CatalogDependencies) {
  const { unitOfWork, clock, images, imageFetcher } = dependencies;

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
      const needsImport = input.enabled && state.importedVersion === null;
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

  return { requestSync, setSetEnabled, enableStandardSets, imageFor };
}
