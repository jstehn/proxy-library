import { withDb, type DbExecutor } from "@/shared/db";
import { boosterOptions, draftableBoosters, draftsOverview, draftView } from "./queries/drafts";

// The drafts' capabilities (ADR 0026): what the draft pages read.

export function wireDraftCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    draftReads: {
      boosters: withDb(db, draftableBoosters),
      boosterOptions: withDb(db, boosterOptions),
      overview: withDb(db, draftsOverview),
      view: withDb(db, draftView),
    },
  };
}
