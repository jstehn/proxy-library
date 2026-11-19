// Column types every module's schema.ts shares (refactor P02).
import { bigint, timestamp } from "drizzle-orm/pg-core";

/** A timestamp with time zone (Postgres `timestamptz`). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Money in integer cents (Postgres `bigint`, read as a JavaScript number). */
export const cents = (name: string) => bigint(name, { mode: "number" });
