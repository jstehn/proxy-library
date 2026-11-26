import type { UnitOfWork } from "@/shared/kernel";
import { makeCatalogAdmin, makeSync, type CardsDependencies, type CardsServices } from "./cards";
import {
  makeEdhrecSync,
  makeEmbedCards,
  makeSpellbookSync,
  type OutsideDependencies,
} from "./outside";
import { makeComprehensiveRulesSync, type RulesDependencies, type RulesServices } from "./rules";

/** Everything the catalog reads and writes in one transaction: each area's services together. */
export type CatalogServices = CardsServices & RulesServices;

/** Each area's dependencies together; `unitOfWork` is the one that covers every area. */
export type CatalogDependencies = Omit<CardsDependencies, "unitOfWork"> &
  Omit<OutsideDependencies, "unitOfWork"> &
  Omit<RulesDependencies, "unitOfWork"> & { unitOfWork: UnitOfWork<CatalogServices> };

/** Builds every catalog use case from one set of dependencies. */
export function makeCatalog(dependencies: CatalogDependencies) {
  return {
    ...makeSync(dependencies),
    ...makeCatalogAdmin(dependencies),
    ...makeEdhrecSync(dependencies),
    ...makeEmbedCards(dependencies),
    ...makeSpellbookSync(dependencies),
    ...makeComprehensiveRulesSync(dependencies),
  };
}

export type Catalog = ReturnType<typeof makeCatalog>;
