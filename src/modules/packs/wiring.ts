import { withDb, type DbExecutor } from "@/shared/db";
import { packThemes } from "./queries/themes";

// The packs' capabilities (ADR 0026).

export function wirePackCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return { packReads: { themes: withDb(db, packThemes) } };
}
