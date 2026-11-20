import { accountPublicQueries, accountQueries } from "@/modules/accounts";
import { activityQueries } from "@/modules/activity";
import { catalogQueries } from "@/modules/catalog";
import { collectionQueries } from "@/modules/collection";
import { deckPublicQueries, deckQueries } from "@/modules/decks";
import { draftQueries } from "@/modules/drafts";
import { inventoryQueries } from "@/modules/inventory";
import { packsQueries } from "@/modules/packs";
import { realCollectionQueries } from "@/modules/real-collection";
import { tradeQueries } from "@/modules/trades";
import { socialQueries } from "@/modules/social";
import { wishlistQueries } from "@/modules/wishlist";
import { storeQueries } from "@/modules/store";
import { walletQueries } from "@/modules/wallet";
import { bindDb, bindPublicDb, type DbExecutor } from "@/shared/db";

// `reads` (design doc 67, ADR 0026 addendum): each module's query functions with the database
// filled in. Pages, actions and tool endpoints call `reads.<module>.<query>(actor, ...)`; a read
// that shows one player's data takes the `Actor` and filters by it in SQL, so it can't be asked
// for someone else's. Capabilities are for writes and for anything with rules.

/** Every module's reads, bound to one database. Built once, in `core.ts`. */
export function buildReads(db: DbExecutor) {
  const publicReads = buildPublicReads(db);
  return {
    // A signed-in player also reaches the visitor reads (the shared-deck page serves both).
    accounts: { ...bindDb(db, accountQueries), ...publicReads.accounts },
    activity: bindDb(db, activityQueries),
    catalog: bindDb(db, catalogQueries),
    collection: bindDb(db, collectionQueries),
    decks: { ...bindDb(db, deckQueries), ...publicReads.decks },
    drafts: bindDb(db, draftQueries),
    inventory: bindDb(db, inventoryQueries),
    packs: bindDb(db, packsQueries),
    realCollection: bindDb(db, realCollectionQueries),
    social: bindDb(db, socialQueries),
    store: bindDb(db, storeQueries),
    trades: bindDb(db, tradeQueries),
    wallet: bindDb(db, walletQueries),
    wishlist: bindDb(db, wishlistQueries),
  };
}
export type Reads = ReturnType<typeof buildReads>;

/**
 * The reads a visitor (no one signed in) may call: the credential is a token (a shared deck's
 * link) or nothing at all. A read that takes a player doesn't compile here, so a visitor's page
 * can't reach one.
 */
export function buildPublicReads(db: DbExecutor) {
  return {
    accounts: bindPublicDb(db, accountPublicQueries),
    decks: bindPublicDb(db, deckPublicQueries),
  };
}
export type PublicReads = ReturnType<typeof buildPublicReads>;
