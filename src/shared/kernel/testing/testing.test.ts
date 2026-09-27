import { describe, expect, it } from "vitest";
import { ok } from "../result";
import { fixedClock, inMemoryUnitOfWork, manualClock } from "./index";

describe("fixedClock", () => {
  it("always returns the same instant, as a fresh Date each time", () => {
    const clock = fixedClock("2026-01-01T00:00:00Z");
    const first = clock.now();
    first.setFullYear(1999); // mutating a returned Date must not affect the clock
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("manualClock", () => {
  it("moves only when told", () => {
    const clock = manualClock("2026-01-01T00:00:00Z");
    clock.advanceBy(7 * 24 * 60 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2026-01-08T00:00:00.000Z");
    clock.set("2027-01-01T00:00:00Z");
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("inMemoryUnitOfWork", () => {
  it("passes the services to the work and returns its result", async () => {
    const uow = inMemoryUnitOfWork({ greeting: "hi" });
    await expect(uow.run(async ({ greeting }) => ok(greeting))).resolves.toEqual(ok("hi"));
  });
});
