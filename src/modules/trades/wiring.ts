import { withDb, type DbExecutor } from "@/shared/db";
import { tradeView, tradesFor, tradesWaitingForYou, tradingPartners } from "./queries/trades";

// The trades module's capabilities (ADR 0026): what its pages read, each a query with the database
// filled in. They forward to the query functions until those merge into real capabilities
// (docs/refactor/removal-list.md).

export function wireTradeCapabilities(dependencies: Readonly<{ db: DbExecutor }>) {
  const { db } = dependencies;
  return {
    tradeReads: {
      tradesFor: withDb(db, tradesFor),
      waitingForYou: withDb(db, tradesWaitingForYou),
      view: withDb(db, tradeView),
      partners: withDb(db, tradingPartners),
    },
  };
}
