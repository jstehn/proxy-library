import type { DbExecutor } from "@/shared/db";
import type { DeckAuditReport } from "../domain/audit-report";
import { auditDeckView } from "./audit";
import { publicDeckByToken } from "./sharing";

export type PublicDeckScorecard = Readonly<{
  ownerName: string;
  report: DeckAuditReport;
}>;

/**
 * Builds a shareable scorecard for a publicly shared deck token.
 */
export async function publicDeckScorecard(
  db: DbExecutor,
  token: string,
): Promise<PublicDeckScorecard | null> {
  const found = await publicDeckByToken(db, token);
  if (found === null) return null;
  const report = await auditDeckView(db, found.view);
  return {
    ownerName: found.ownerName,
    report,
  };
}
