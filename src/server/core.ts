// The wiring shared by both composition roots (the Next.js app and the worker).
// This is the ONLY place that constructs real adapters and passes them to factories.
// Each phase adds its module's repositories and services here.
import type { Config } from "@/shared/config";
import { createDatabase, makeDrizzleUnitOfWork, makeSystemService } from "@/shared/db";
import { systemClock } from "@/shared/runtime";
import { makeCheckHealth } from "./health";

export function buildCore(config: Config) {
  const { db, close } = createDatabase(config.databaseUrl);
  const clock = systemClock();

  // Transaction-bound services (ADR 0005): rebuilt around each transaction `tx`.
  const uow = makeDrizzleUnitOfWork(db, (tx) => ({
    system: makeSystemService(tx),
  }));

  return {
    config,
    db,
    clock,
    uow,
    checkHealth: makeCheckHealth({ uow, clock }),
    close,
  };
}

export type Core = ReturnType<typeof buildCore>;
