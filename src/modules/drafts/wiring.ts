import { withDb, type DbExecutor } from "@/shared/db";
import {
  activeDraftOf,
  boosterOptions,
  draftVersion,
  draftView,
  draftableBoosters,
  draftsOverview,
} from "./queries/drafts";

// The drafts module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireDraftCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    draftReads: {
      boosters: withDb(db, draftableBoosters),
      boosterOptions: withDb(db, boosterOptions),
      overview: withDb(db, draftsOverview),
      view: withDb(db, draftView),
      activeDraftOf: withDb(db, activeDraftOf),
      version: withDb(db, draftVersion),
    },
  };
}
