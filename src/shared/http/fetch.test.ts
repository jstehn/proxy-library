import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { manualClock } from "@/shared/kernel/testing";
import { withRateLimit, withRetry, withUserAgent, type Fetch } from "./fetch";

/** A fake fetch that records calls and answers with the given statuses in turn. */
function fakeFetch(statuses: number[] = [200]) {
  const calls: { url: string; headers: Headers; at?: number }[] = [];
  let index = 0;
  const fetchFn: Fetch = async (url, init) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    const status = statuses[Math.min(index++, statuses.length - 1)];
    return new Response("{}", { status });
  };
  return { fetchFn, calls };
}

/** A sleep that doesn't wait: it just moves the manual clock forward and records the wait. */
function fakeSleep(clock: ReturnType<typeof manualClock>) {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (milliseconds: number) => {
      waits.push(milliseconds);
      clock.advanceBy(milliseconds);
    },
  };
}

describe("withUserAgent", () => {
  it("adds User-Agent and Accept headers, keeping an existing Accept", async () => {
    const { fetchFn, calls } = fakeFetch();
    const wrapped = withUserAgent("TestAgent/1.0")(fetchFn);
    await wrapped("https://example.test/a");
    await wrapped("https://example.test/b", { headers: { Accept: "image/*" } });
    expect(calls[0].headers.get("User-Agent")).toBe("TestAgent/1.0");
    expect(calls[0].headers.get("Accept")).toContain("application/json");
    expect(calls[1].headers.get("Accept")).toBe("image/*");
  });
});

describe("withRateLimit", () => {
  it("spaces requests made at the same moment 125 ms apart for 8 per second", async () => {
    const clock = manualClock("2026-01-01T00:00:00Z");
    // All four start at the same instant, so this sleep only records how long each would wait
    // (moving the clock here would wrongly age the requests that haven't started yet).
    const waits: number[] = [];
    const sleep = async (milliseconds: number) => {
      waits.push(milliseconds);
    };
    const { fetchFn } = fakeFetch();
    const limited = withRateLimit({ perSecond: 8, clock, sleep })(fetchFn);

    // Start 4 requests before any of them waits: they reserve slots 0, 125, 250, 375 ms.
    await Promise.all([limited("a"), limited("b"), limited("c"), limited("d")]);
    expect(waits).toEqual([125, 250, 375]);
  });

  it("spaces any number of simultaneous requests evenly, in whole milliseconds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 30 }),
        async (perSecond, requests) => {
          const clock = manualClock("2026-01-01T00:00:00Z");
          const waits: number[] = [];
          const sleep = async (milliseconds: number) => {
            waits.push(milliseconds);
          };
          const limited = withRateLimit({ perSecond, clock, sleep })(fakeFetch().fetchFn);
          await Promise.all(Array.from({ length: requests }, (_, i) => limited(`r${i}`)));
          const interval = Math.ceil(1000 / perSecond);
          expect(waits).toEqual(Array.from({ length: requests - 1 }, (_, i) => (i + 1) * interval));
        },
      ),
    );
  });

  it("doesn't wait when requests are already far enough apart", async () => {
    const clock = manualClock("2026-01-01T00:00:00Z");
    const { sleep, waits } = fakeSleep(clock);
    const limited = withRateLimit({ perSecond: 8, clock, sleep })(fakeFetch().fetchFn);
    await limited("a");
    clock.advanceBy(1000);
    await limited("b");
    expect(waits).toEqual([]);
  });
});

describe("withRetry", () => {
  it("retries 429 and 5xx with growing delays, then returns the success", async () => {
    const clock = manualClock("2026-01-01T00:00:00Z");
    const { sleep, waits } = fakeSleep(clock);
    const { fetchFn, calls } = fakeFetch([503, 429, 200]);
    const response = await withRetry({ attempts: 3, sleep })(fetchFn)("https://example.test");
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([500, 1000]);
  });

  it("gives up after the last attempt and returns the final response", async () => {
    const clock = manualClock("2026-01-01T00:00:00Z");
    const { sleep } = fakeSleep(clock);
    const { fetchFn, calls } = fakeFetch([500]);
    const response = await withRetry({ attempts: 2, sleep })(fetchFn)("https://example.test");
    expect(response.status).toBe(500);
    expect(calls).toHaveLength(2);
  });

  it("does not retry other errors such as 404", async () => {
    const clock = manualClock("2026-01-01T00:00:00Z");
    const { sleep } = fakeSleep(clock);
    const { fetchFn, calls } = fakeFetch([404]);
    expect((await withRetry({ attempts: 3, sleep })(fetchFn)("x")).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("retries network failures, and rethrows the last one", async () => {
    const clock = manualClock("2026-01-01T00:00:00Z");
    const { sleep } = fakeSleep(clock);
    let calls = 0;
    const failing: Fetch = async () => {
      calls++;
      throw new Error("network down");
    };
    await expect(withRetry({ attempts: 3, sleep })(failing)("x")).rejects.toThrow("network down");
    expect(calls).toBe(3);
  });
});
