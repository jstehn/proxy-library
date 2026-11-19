import { withDb, type DbExecutor } from "@/shared/db";
import {
  currentEconomySettings,
  playerMoney,
  walletHistory,
  walletSummary,
} from "./queries/wallet";

// The wallet module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireWalletCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    walletReads: {
      economySettings: withDb(db, currentEconomySettings),
      playerMoney: withDb(db, playerMoney),
      history: withDb(db, walletHistory),
      summary: withDb(db, walletSummary),
    },
  };
}
