// The wiring shared by both composition roots (the Next.js app and the worker).
// This is the ONLY place that creates real implementations (database, clock, ...) and
// hands them to the functions that need them. Each phase adds its module's services here.
import { makeAccounts } from "@/modules/accounts";
import {
  betterAuthIdentityProvider,
  createAuth,
  cryptoSecretGenerator,
  drizzleInviteRepository,
  drizzlePlayerRepository,
} from "@/modules/accounts/infrastructure";
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
  const auth = createAuth({ db, secret: config.authSecret, appUrl: config.appUrl });

  // Called at the start of every transaction: builds each module's services so that all
  // of their database work happens inside that one transaction (ADR 0005).
  function servicesFor(transaction: DbExecutor) {
    return {
      system: makeSystemService(transaction),
      players: drizzlePlayerRepository(transaction),
      invites: drizzleInviteRepository(transaction),
    };
  }

  const unitOfWork = makeDrizzleUnitOfWork(db, servicesFor);

  const accounts = makeAccounts({
    unitOfWork,
    identity: betterAuthIdentityProvider(auth),
    secrets: cryptoSecretGenerator(),
    clock,
  });

  return {
    config,
    db,
    clock,
    unitOfWork,
    accounts,
    checkHealth: makeCheckHealth({ unitOfWork, clock }),
    close,
  };
}

export type Core = ReturnType<typeof buildCore>;
