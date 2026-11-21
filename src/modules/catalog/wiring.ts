import { pickForAdmin } from "@/modules/accounts";
import type { DbExecutor } from "@/shared/db";
import { pick } from "@/shared/kernel";
import type { Catalog } from "./make-catalog";
import { printingCards } from "./cards";

// The catalog's capabilities (ADR 0026): only what callers use. The two image ones are for routes,
// which have no player. The sync and the other jobs belong to the worker, which holds the service.

export function wireCatalogCapabilities(
  dependencies: Readonly<{ catalog: Catalog; db: DbExecutor }>,
) {
  const { catalog, db } = dependencies;
  return {
    catalog: {
      ...pick(catalog, "imageFor", "artworkFor"),
      ...pickForAdmin(
        catalog,
        "choosePhoto",
        "clearPhotoChoice",
        "enableStandardSets",
        "requestSync",
        "setPageSlug",
        "setSetEnabled",
      ),
    },
    /** Card details for printings, for the selected-card panel and previews. */
    printingDetails: (printingIds: readonly string[]) => printingCards(db, printingIds),
  };
}
