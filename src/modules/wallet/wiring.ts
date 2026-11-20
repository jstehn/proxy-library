import { pickForAdmin } from "@/modules/accounts";
import { pick } from "@/shared/kernel";
import type { Wallet } from "./application/make-wallet";

// The wallet module's capabilities (ADR 0026): only what callers use. Paying every allowance due
// is the admin's, though it takes no player: the AdminActor shows the caller is allowed.

export function wireWalletCapabilities({ wallet }: Readonly<{ wallet: Wallet }>) {
  return {
    wallet: {
      ...pick(wallet, "refreshWallet", "addOwnFunds"),
      ...pickForAdmin(
        wallet,
        "grantMoney",
        "correctBalance",
        "updateEconomySettings",
        "refreshAllWallets",
      ),
    },
  };
}
