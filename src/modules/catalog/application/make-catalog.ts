import { makeCatalogAdmin } from "./admin";
import type { CatalogDependencies } from "./ports";
import { makeSync } from "./sync";

/** Builds every catalog use case from one set of dependencies. */
export function makeCatalog(dependencies: CatalogDependencies) {
  return {
    ...makeSync(dependencies),
    ...makeCatalogAdmin(dependencies),
  };
}

export type Catalog = ReturnType<typeof makeCatalog>;
