import type { Metadata } from "next";
import { readPage } from "@/server/page-instance";
import { Badge, type BadgeTone } from "@/ui/badge";
import { EmptyState } from "@/ui/empty-state";
import { Page } from "@/ui/page";

export const metadata: Metadata = { title: "Performance" };

const KIND_TONES: Record<"mcp" | "tool" | "action", BadgeTone> = {
  mcp: "violet",
  tool: "sky",
  action: "amber",
};

export default async function AdminPerformancePage() {
  const { actor: admin, capabilities } = await readPage({ admin: true });
  const report = await capabilities.site.performanceReport(admin);

  return (
    <Page width="6xl" spacing="wide">
      <h1 className="text-2xl font-semibold">Performance</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Recent Tool Calls &amp; Slow Actions</h2>
        <p className="text-muted text-sm">
          In-memory ring buffer of the last 100 MCP calls, HTTP tool calls, and server actions in
          this server process, newest first.
        </p>
        {report.recent.length === 0 ? (
          <EmptyState>No operations recorded in this process yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-border-subtle border-b text-left">
                  <th className="py-1.5 pr-3 font-medium">Kind</th>
                  <th className="py-1.5 pr-3 font-medium">Operation</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Wall</th>
                  <th className="py-1.5 pr-3 text-right font-medium">SQL</th>
                  <th className="py-1.5 pr-3 text-right font-medium">HTTP</th>
                  <th className="py-1.5 font-medium">Slowest SQL / Hosts</th>
                </tr>
              </thead>
              <tbody>
                {report.recent.map((entry, index) => (
                  <tr
                    key={`${entry.startedAtMs}-${entry.label}-${index}`}
                    className="border-border-subtle border-b align-top"
                  >
                    <td className="py-1.5 pr-3">
                      <Badge tone={KIND_TONES[entry.kind]} size="sm">
                        {entry.kind}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3">
                      <code className="text-xs break-all">{entry.label}</code>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {entry.wallMs.toFixed(1)} ms
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      <div>
                        {entry.sqlCount} ({entry.sqlMs.toFixed(1)} ms)
                      </div>
                      <div className="text-muted text-xs">
                        max {entry.sqlMaxMs.toFixed(1)} ms
                        {entry.txCount > 0 ? ` · ${entry.txCount} tx` : ""}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {entry.httpCount > 0
                        ? `${entry.httpCount} (${entry.httpMs.toFixed(1)} ms)`
                        : "—"}
                    </td>
                    <td className="py-1.5">
                      {entry.slowestSql !== null && (
                        <code className="text-muted block max-w-md truncate text-xs">
                          {entry.slowestSql}
                        </code>
                      )}
                      {entry.httpHosts.length > 0 && (
                        <div className="text-muted text-xs">{entry.httpHosts.join(", ")}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Top Postgres Queries</h2>
        {report.topQueries === null ? (
          <EmptyState>
            <code>pg_stat_statements</code> is unavailable in this Postgres instance (locally,
            enable <code>shared_preload_libraries=pg_stat_statements</code> to inspect query
            statistics).
          </EmptyState>
        ) : report.topQueries.length === 0 ? (
          <EmptyState>No statements recorded in pg_stat_statements yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-border-subtle border-b text-left">
                  <th className="py-1.5 pr-3 font-medium">Query</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Calls</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Mean</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Total</th>
                  <th className="py-1.5 text-right font-medium">Rows</th>
                </tr>
              </thead>
              <tbody>
                {report.topQueries.map((row, index) => (
                  <tr
                    key={`${index}-${row.query.slice(0, 24)}`}
                    className="border-border-subtle border-b align-top"
                  >
                    <td className="py-1.5 pr-3">
                      <code className="text-xs break-all">{row.query}</code>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{row.calls}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {row.mean_ms.toFixed(1)} ms
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {row.total_ms.toFixed(1)} ms
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  );
}
