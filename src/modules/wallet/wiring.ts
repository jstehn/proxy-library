import { pickForAdmin, type AdminActor } from "@/modules/accounts";
import { pick } from "@/shared/kernel";
import type { Wallet } from "./application/make-wallet";

// The wallet module's capabilities (ADR 0026): only what callers use.

export function wireWalletCapabilities({ wallet }: Readonly<{ wallet: Wallet }>) {
  return {
    wallet: {
      ...pick(wallet, "refreshWallet", "addOwnFunds"),
      ...pickForAdmin(wallet, "grantMoney", "correctBalance", "updateEconomySettings"),
      refreshAllWallets: (_admin: AdminActor) => wallet.refreshAllWallets(),
    },
  };
}
