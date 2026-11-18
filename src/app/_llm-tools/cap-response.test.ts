import { describe, expect, it } from "vitest";
import { capToolResponse, MAX_TOOL_RESPONSE_BYTES } from "./cap-response";

describe("capToolResponse", () => {
  it("returns small payloads unchanged", () => {
    const payload = { ok: true, items: [1, 2, 3] };
    expect(capToolResponse(payload)).toEqual(payload);
  });

  it("paginates the largest array under MAX_TOOL_RESPONSE_BYTES with a next cursor", () => {
    const bigText = "x".repeat(800);
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, text: bigText }));
    const payload = { deckId: 51, lines: items };

    const page1 = capToolResponse(payload) as typeof payload & {
      next?: number;
      totalCount: number;
      truncatedByCap: boolean;
    };
    expect(Buffer.byteLength(JSON.stringify(page1), "utf8")).toBeLessThanOrEqual(
      MAX_TOOL_RESPONSE_BYTES,
    );
    expect(page1.truncatedByCap).toBe(true);
    expect(page1.totalCount).toBe(100);
    expect(page1.lines.length).toBeGreaterThan(0);
    expect(page1.lines.length).toBeLessThan(100);
    expect(page1.next).toBe(page1.lines.length);
    expect(page1.lines[0]?.id).toBe(0);

    const page2 = capToolResponse(payload, page1.next) as typeof payload & {
      next?: number;
      totalCount: number;
      truncatedByCap: boolean;
    };
    expect(Buffer.byteLength(JSON.stringify(page2), "utf8")).toBeLessThanOrEqual(
      MAX_TOOL_RESPONSE_BYTES,
    );
    expect(page2.lines[0]?.id).toBe(page1.next);
  });

  it("drops secondary bulky fields when secondary fields alone exceed the budget", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: i, text: "y".repeat(600) }));
    const payload = {
      deckId: 51,
      list: "1 Sol Ring\n".repeat(3500),
      lines: items,
    };

    const capped = capToolResponse(payload) as Record<string, unknown>;
    expect(Buffer.byteLength(JSON.stringify(capped), "utf8")).toBeLessThanOrEqual(
      MAX_TOOL_RESPONSE_BYTES,
    );
    expect(capped.truncatedByCap).toBe(true);
    expect(capped.omittedFields).toContain("list");
    expect(Array.isArray(capped.lines)).toBe(true);
  });
});
