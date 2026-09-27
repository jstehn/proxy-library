// The wiring shared by both composition roots (the Next.js app and the worker).
// This is the ONLY place that creates real implementations (database, clock, ...) and
// hands them to the functions that need them. Each phase adds its module's services here.
import type { Config } from "@/shared/config";
import {
  createDatabase,
  makeDrizzleUnitOfWork,
  makeSystemService,
  type DbExecutor,
} from "@/shared/db";
import { systemClock } from "@/shared/runtime";
import { makeCheckHealth } from "./health";

export function buildCore(config: Config) {
  const { db, close } = createDatabase(config.databaseUrl);
  const clock = systemClock();

  // Called at the start of every transaction: builds each module's services so that all
  // of their database work happens inside that one transaction (ADR 0005).
  function servicesFor(transaction: DbExecutor) {
    return {
      system: makeSystemService(transaction),
    };
  }

  const unitOfWork = makeDrizzleUnitOfWork(db, servicesFor);

  return {
    config,
    db,
    clock,
    unitOfWork,
    checkHealth: makeCheckHealth({ unitOfWork, clock }),
    close,
  };
}

export type Core = ReturnType<typeof buildCore>;
