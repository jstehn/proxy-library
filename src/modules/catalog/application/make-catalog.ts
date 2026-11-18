import { makeCatalogAdmin } from "./admin";
import { makeEdhrecSync } from "./edhrec";
import { makeEmbedCards } from "./embed";
import type { CatalogDependencies } from "./ports";
import { makeComprehensiveRulesSync } from "./rules";
import { makeSync } from "./sync";

/** Builds every catalog use case from one set of dependencies. */
export function makeCatalog(dependencies: CatalogDependencies) {
  return {
    ...makeSync(dependencies),
    ...makeCatalogAdmin(dependencies),
    ...makeEdhrecSync(dependencies),
    ...makeEmbedCards(dependencies),
    ...makeComprehensiveRulesSync(dependencies),
  };
}

export type Catalog = ReturnType<typeof makeCatalog>;
