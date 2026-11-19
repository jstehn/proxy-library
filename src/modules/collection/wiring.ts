import { withDb, type DbExecutor } from "@/shared/db";
import { collectionPage, ownedCopies } from "./queries/collection";

// The collection's capabilities (ADR 0026): what the collection pages read.

export function wireCollectionCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return { collectionReads: { page: withDb(db, collectionPage), ownedCopies: withDb(db, ownedCopies) } };
}
