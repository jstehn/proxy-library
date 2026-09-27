import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/shared/config";
import { err, ok } from "@/shared/kernel";
import { createDatabase, type DbExecutor } from "./client";
import { makeDrizzleUnitOfWork } from "./unit-of-work";

// A throwaway table that exists only for this test file.
const { db, close } = createDatabase(loadConfig().databaseUrl);

const probeService = (tx: DbExecutor) => ({
  insert: (note: string) => tx.execute(sql`insert into uow_probe (note) values (${note})`),
});

const uow = makeDrizzleUnitOfWork(db, (tx) => ({ probe: probeService(tx) }));

async function notes(): Promise<string[]> {
  const result = await db.execute<{ note: string }>(sql`select note from uow_probe order by id`);
  return result.rows.map((row) => row.note);
}

beforeAll(async () => {
  await db.execute(
    sql`create table if not exists uow_probe (id serial primary key, note text not null)`,
  );
});
beforeEach(async () => {
  await db.execute(sql`truncate uow_probe`);
});
afterAll(async () => {
  await db.execute(sql`drop table if exists uow_probe`);
  await close();
});

describe("makeDrizzleUnitOfWork", () => {
  it("commits when the work returns ok", async () => {
    const result = await uow.run(async ({ probe }) => {
      await probe.insert("kept");
      return ok("done");
    });

    expect(result).toEqual(ok("done"));
    expect(await notes()).toEqual(["kept"]);
  });

  it("rolls back every write when the work returns err, and returns the err", async () => {
    const result = await uow.run(async ({ probe }) => {
      await probe.insert("first");
      await probe.insert("second");
      return err({ kind: "InsufficientFunds" as const });
    });

    expect(result).toEqual(err({ kind: "InsufficientFunds" }));
    expect(await notes()).toEqual([]);
  });

  it("rolls back and rethrows when the work throws (a defect)", async () => {
    const boom = new Error("boom");
    await expect(
      uow.run(async ({ probe }) => {
        await probe.insert("doomed");
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await notes()).toEqual([]);
  });
});
