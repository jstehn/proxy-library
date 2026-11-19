import { describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import type { Capabilities } from "./capabilities";
import { makeReadPage } from "./page";

const actor = { username: "jack" } as unknown as Actor;
const capabilities = { marker: true } as unknown as Capabilities;

describe("readPage", () => {
  it("gives a signed-in page the actor and the capabilities", async () => {
    const readPage = makeReadPage({
      requireActor: async () => actor,
      requireAdminActor: async () => actor,
      currentActor: async () => null,
      capabilities: () => capabilities,
    });
    const context = await readPage();
    expect(context.actor).toBe(actor);
    expect(context.capabilities).toBe(capabilities);
  });

  it("lets a visitor through only when the page allows visitors", async () => {
    const readPage = makeReadPage({
      requireAdminActor: async () => actor,
      requireActor: async () => {
        throw new Error("redirected to sign-in");
      },
      currentActor: async () => null,
      capabilities: () => capabilities,
    });
    await expect(readPage()).rejects.toThrow("redirected");
    expect((await readPage({ allowVisitors: true })).actor).toBeNull();
  });

  it("asks for an admin when the page says so", async () => {
    const asked: string[] = [];
    const readPage = makeReadPage({
      requireActor: async () => {
        asked.push("player");
        return actor;
      },
      requireAdminActor: async () => {
        asked.push("admin");
        return actor;
      },
      currentActor: async () => null,
      capabilities: () => capabilities,
    });
    await readPage({ admin: true });
    expect(asked).toEqual(["admin"]);
  });
});
