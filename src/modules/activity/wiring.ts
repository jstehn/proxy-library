import { withDb, type DbExecutor } from "@/shared/db";
import { activityFeed } from "./queries/feed";

// The activity module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireActivityCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    activityReads: {
      feed: withDb(db, activityFeed),
    },
  };
}
