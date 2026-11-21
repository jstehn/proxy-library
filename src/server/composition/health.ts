import { err, ok, type Clock, type Result, type UnitOfWork } from "@/shared/kernel";

/** What a successful health check reports. */
export type HealthReport = Readonly<{
  status: "ok";
  appTime: string;
  databaseTime: string;
}>;

/** Why a health check can fail. */
export type HealthError = Readonly<{
  kind: "DatabaseUnavailable";
  message: string;
}>;

/** The database operations a health check needs while a transaction is open. */
type HealthCheckServices = {
  system: {
    databaseTime(): Promise<Date>;
  };
};

/** Everything checkHealth needs from outside. It's passed in, never imported directly. */
export type CheckHealthDependencies = {
  unitOfWork: UnitOfWork<HealthCheckServices>;
  clock: Clock;
};

/**
 * Builds the `checkHealth` function.
 *
 * Call this once at startup with the real dependencies (or, in tests, with fakes). The
 * function it returns can then be called any number of times, and it always uses the
 * dependencies it was built with.
 */
export function makeCheckHealth(dependencies: CheckHealthDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function checkHealth(): Promise<Result<HealthReport, HealthError>> {
    try {
      return await unitOfWork.run(async (services) => {
        const databaseTime = await services.system.databaseTime();
        const report: HealthReport = {
          status: "ok",
          appTime: clock.now().toISOString(),
          databaseTime: databaseTime.toISOString(),
        };
        return ok(report);
      });
    } catch (error) {
      // For a health check, an unreachable database is an expected answer, not a bug.
      return err({ kind: "DatabaseUnavailable", message: String(error) });
    }
  }

  return checkHealth;
}
