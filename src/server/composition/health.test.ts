import { describe, expect, it } from "vitest";
import { err, ok } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { makeCheckHealth } from "./health";

// Testing with injected dependencies: we pass in a pretend database and a frozen clock,
// yet checkHealth runs exactly the same code as in the real app.
describe("checkHealth", () => {
  it("reports app and database time", async () => {
    const checkHealth = makeCheckHealth({
      unitOfWork: inMemoryUnitOfWork({
        system: { databaseTime: async () => new Date("2026-01-01T00:00:01Z") },
      }),
      clock: fixedClock("2026-01-01T00:00:00Z"),
    });

    expect(await checkHealth()).toEqual(
      ok({
        status: "ok",
        appTime: "2026-01-01T00:00:00.000Z",
        databaseTime: "2026-01-01T00:00:01.000Z",
      }),
    );
  });

  it("turns an unreachable database into a DatabaseUnavailable error", async () => {
    const checkHealth = makeCheckHealth({
      unitOfWork: inMemoryUnitOfWork({
        system: {
          databaseTime: async () => {
            throw new Error("connect ENOENT .dev/.s.PGSQL.5432");
          },
        },
      }),
      clock: fixedClock("2026-01-01T00:00:00Z"),
    });

    expect(await checkHealth()).toEqual(
      err({ kind: "DatabaseUnavailable", message: "Error: connect ENOENT .dev/.s.PGSQL.5432" }),
    );
  });
});
