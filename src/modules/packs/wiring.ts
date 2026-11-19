import { withDb, type DbExecutor } from "@/shared/db";
import { availableBoosters } from "./queries/boosters";
import { packThemes } from "./queries/themes";

// The packs module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wirePackCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    packReads: {
      themes: withDb(db, packThemes),
      availableBoosters: withDb(db, availableBoosters),
    },
  };
}
