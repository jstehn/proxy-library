import { withDb, type DbExecutor } from "@/shared/db";
import { collectionPage, exportRows, ownedCopies } from "./queries/collection";

// The collection module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireCollectionCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    collectionReads: {
      page: withDb(db, collectionPage),
      ownedCopies: withDb(db, ownedCopies),
      exportRows: withDb(db, exportRows),
    },
  };
}
