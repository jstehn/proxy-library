import { err, ok, type Clock, type Result, type UnitOfWork } from "@/shared/kernel";

export type HealthReport = Readonly<{
  status: "ok";
  appTime: string;
  databaseTime: string;
}>;

export type HealthError = Readonly<{ kind: "DatabaseUnavailable"; message: string }>;

// The narrow service bundle this use case needs (interface segregation): the container's
// full bundle satisfies it structurally, and tests can pass just this.
type HealthTx = { system: { databaseTime(): Promise<Date> } };

/**
 * Walking-skeleton use case: proves the wiring end to end
 * (route → container → unit of work → database).
 */
export function makeCheckHealth(deps: { uow: UnitOfWork<HealthTx>; clock: Clock }) {
  return async (): Promise<Result<HealthReport, HealthError>> => {
    try {
      return await deps.uow.run(async ({ system }) => {
        const databaseTime = await system.databaseTime();
        return ok({
          status: "ok",
          appTime: deps.clock.now().toISOString(),
          databaseTime: databaseTime.toISOString(),
        });
      });
    } catch (error) {
      // For a health check, an unreachable database is an expected answer, not a defect.
      return err({ kind: "DatabaseUnavailable", message: String(error) });
    }
  };
}
