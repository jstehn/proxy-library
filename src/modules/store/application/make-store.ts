import { makeBuyList } from "./buy-list";
import { makeBuySealed } from "./buy-sealed";
import { makeManagePrices } from "./manage-prices";
import type { StoreDependencies } from "./ports";
import { makeBuySingle, makeSellSingle, makeSetBuylistRate } from "./singles";
import { makeValueProducts } from "./value-products";

/** Builds every store use case from one set of dependencies. */
export function makeStore(dependencies: StoreDependencies) {
  const { setKindPrice, setProductPrice, setPricingMode } = makeManagePrices(dependencies);
  const { valueProducts, valueProductsIfStale } = makeValueProducts(dependencies);
  return {
    buySealed: makeBuySealed(dependencies),
    setKindPrice,
    setProductPrice,
    setPricingMode,
    buySingle: makeBuySingle(dependencies),
    buyList: makeBuyList(dependencies),
    sellSingle: makeSellSingle(dependencies),
    setBuylistRate: makeSetBuylistRate(dependencies),
    valueProducts,
    valueProductsIfStale,
  };
}

export type Store = ReturnType<typeof makeStore>;
