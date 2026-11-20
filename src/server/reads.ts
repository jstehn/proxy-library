import { activityQueries } from "@/modules/activity";
import { inventoryQueries } from "@/modules/inventory";
import { packsQueries } from "@/modules/packs";
import { bindDb, type DbExecutor } from "@/shared/db";

// `reads` (design doc 67, ADR 0026 addendum): each module's query functions with the database
// filled in. Pages, actions and tool endpoints call `reads.<module>.<query>(actor, ...)`; a read
// that shows one player's data takes the `Actor` and filters by it in SQL, so it can't be asked
// for someone else's. Capabilities are for writes and for anything with rules.

/** Every module's reads, bound to one database. Built once, in `core.ts`. */
export function buildReads(db: DbExecutor) {
  return {
    activity: bindDb(db, activityQueries),
    inventory: bindDb(db, inventoryQueries),
    packs: bindDb(db, packsQueries),
  };
}
export type Reads = ReturnType<typeof buildReads>;

/**
 * The reads a visitor (no one signed in) may call: the credential is a token (a shared deck's
 * link) or nothing at all. A read that takes a player doesn't compile here, so a visitor's page
 * can't reach one.
 */
export function buildPublicReads() {
  return {};
}
export type PublicReads = ReturnType<typeof buildPublicReads>;
