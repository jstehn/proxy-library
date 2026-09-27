import { makeAddOwnFunds, makeCorrectBalance, makeGrantMoney } from "./manage-money";
import type { WalletDependencies } from "./ports";
import { makeRefreshAllWallets, makeRefreshWallet } from "./refresh";
import { makeUpdateEconomySettings } from "./update-economy-settings";

/**
 * Builds every wallet use case from one set of dependencies.
 * The composition root calls this once; tests call it with fakes.
 */
export function makeWallet(dependencies: WalletDependencies) {
  return {
    refreshWallet: makeRefreshWallet(dependencies),
    refreshAllWallets: makeRefreshAllWallets(dependencies),
    grantMoney: makeGrantMoney(dependencies),
    correctBalance: makeCorrectBalance(dependencies),
    addOwnFunds: makeAddOwnFunds(dependencies),
    updateEconomySettings: makeUpdateEconomySettings(dependencies),
  };
}

export type Wallet = ReturnType<typeof makeWallet>;
