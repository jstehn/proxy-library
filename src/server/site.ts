import type { Actor } from "@/modules/accounts";
import type { Wallet } from "@/modules/wallet";
import type { Reads } from "./reads";

// The capabilities of the site itself (ADR 0026): the app's address, fresh seeds and the numbers in
// the site header. Randomness stays on the server, so a seed comes from here, not from a page.

export type SiteWiringDependencies = Readonly<{
  reads: Reads;
  wallet: Wallet;
  seeds: Readonly<{ newSeed(): string }>;
  appUrl: string;
}>;

export function wireSiteCapabilities(dependencies: SiteWiringDependencies) {
  const { reads, wallet, seeds, appUrl } = dependencies;
  return {
    site: {
      appUrl,
      /** A fresh seed, e.g. for the deck builder's test hands (design doc 19). */
      newSeed: () => seeds.newSeed(),
      /**
       * The numbers in the site header, in one round trip. Showing the balance also pays any
       * allowance that has come due (design doc 03, section 5): a write inside a read, so it is a
       * capability.
       */
      headerSummary: async (actor: Actor) => {
        const [balance, waitingTrades, wishesOnTarget, draft, friendRequests] = await Promise.all([
          wallet.refreshWallet(actor),
          reads.trades.waitingForYou(actor),
          reads.wishlist.atTarget(actor),
          reads.drafts.activeDraftOf(actor),
          reads.social.incomingRequestCount(actor),
        ]);
        return { balance, waitingTrades, wishesOnTarget, draft, friendRequests };
      },
    },
  };
}
