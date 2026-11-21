// Column types every module's schema.ts shares (refactor P02).
import { bigint, customType, timestamp } from "drizzle-orm/pg-core";

/** A timestamp with time zone (Postgres `timestamptz`). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Money in integer cents (Postgres `bigint`, read as a JavaScript number). */
export const cents = (name: string) => bigint(name, { mode: "number" });

/** A pgvector column of `dimensions` numbers (the card and rule embeddings). */
export const pgVector = (dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(",")
        .map((n) => Number(n));
    },
  });
