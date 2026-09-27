import { makeBuySealed } from "./buy-sealed";
import { makeManagePrices } from "./manage-prices";
import type { StoreDependencies } from "./ports";

/** Builds every store use case from one set of dependencies. */
export function makeStore(dependencies: StoreDependencies) {
  const { setKindPrice, setProductPrice } = makeManagePrices(dependencies);
  return {
    buySealed: makeBuySealed(dependencies),
    setKindPrice,
    setProductPrice,
  };
}

export type Store = ReturnType<typeof makeStore>;
