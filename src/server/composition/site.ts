import { sql } from "drizzle-orm";
import type { Actor, AdminActor } from "@/modules/accounts";
import type { Wallet } from "@/modules/wallet";
import type { DbExecutor } from "@/shared/db";
import type { Clock } from "@/shared/kernel";
import { recentMetricEntries, type MetricEntry } from "../observability";
import type { makeCheckHealth } from "./health";
import type { Reads } from "./reads";

// The capabilities of the site itself (ADR 0026): the app's address, its health, fresh seeds and the numbers in
// the site header. Randomness stays on the server, so a seed comes from here, not from a page.

type TopQueryRow = Readonly<{
  query: string;
  calls: number;
  mean_ms: number;
  total_ms: number;
  rows: number;
}>;

type PerformanceReport = Readonly<{
  recent: readonly MetricEntry[];
  topQueries: readonly TopQueryRow[] | null;
}>;

export type SiteWiringDependencies = Readonly<{
  db: DbExecutor;
  reads: Reads;
  wallet: Wallet;
  clock: Clock;
  seeds: Readonly<{ newSeed(): string }>;
  appUrl: string;
  checkHealth: ReturnType<typeof makeCheckHealth>;
}>;

export function wireSiteCapabilities(dependencies: SiteWiringDependencies) {
  const { db, reads, wallet, clock, seeds, appUrl, checkHealth } = dependencies;
  return {
    site: {
      appUrl,
      /** Whether the app is up and can reach its database (for the health route). */
      checkHealth,
      /** A fresh seed, e.g. for the deck builder's test hands (design doc 19). */
      newSeed: () => seeds.newSeed(),
      /** Recent operation timings and top Postgres queries for `/admin/performance`. */
      performanceReport: async (admin: AdminActor): Promise<PerformanceReport> => {
        if (!admin.isAdmin) {
          throw new Error("Admin access required");
        }
        let topQueries: readonly TopQueryRow[] | null = null;
        try {
          const result = await db.execute<TopQueryRow>(sql`
            SELECT
              left(regexp_replace(query, '\\s+', ' ', 'g'), 180) AS query,
              calls::int,
              round(mean_exec_time::numeric, 1)::float8 AS mean_ms,
              round(total_exec_time::numeric, 1)::float8 AS total_ms,
              rows::int
            FROM pg_stat_statements
            ORDER BY total_exec_time DESC
            LIMIT 20
          `);
          topQueries = result.rows;
        } catch {
          topQueries = null;
        }
        return {
          recent: recentMetricEntries(),
          topQueries,
        };
      },
      /**
       * The numbers in the site header, in one round trip. Showing the balance also pays any
       * allowance that has come due (design doc 03, section 5): a write inside a read, so it is a
       * capability. When the wallet is already open and no payday is due, we read without taking
       * a row lock or opening a write transaction.
       */
      headerSummary: async (actor: Actor) => {
        const balancePromise = reads.wallet
          .currentBalanceIfUpToDate(actor, clock.now())
          .then((cached) => cached ?? wallet.refreshWallet(actor));
        const [balance, waitingTrades, wishesOnTarget, draft, friendRequests] = await Promise.all([
          balancePromise,
          reads.trades.waitingForYou(actor),
          reads.wishlist.atTarget(actor),
          reads.drafts.activeDraftOf(actor),
          reads.social.incomingRequestCount(actor),
        ]);
        return { balance, waitingTrades, wishesOnTarget, draft, friendRequests };
      },
    },
  };
}
