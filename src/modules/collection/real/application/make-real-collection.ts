import { makeImport } from "./import";
import { makeManageCopies } from "./manage-copies";
import type { RealCollectionDependencies } from "./ports";
import { makeRealProducts } from "./real-products";

/** The real collection's use cases, wired with one set of dependencies (design doc 16). */
export function makeRealCollection(dependencies: RealCollectionDependencies) {
  return {
    ...makeManageCopies(dependencies),
    ...makeImport(dependencies),
    ...makeRealProducts(dependencies),
  };
}

export type RealCollection = ReturnType<typeof makeRealCollection>;
