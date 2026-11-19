import { describe, expect, it } from "vitest";
import { ok } from "@/shared/kernel";
import type { Actor } from "@/modules/accounts";
import { UserId } from "@/shared/kernel";
import type { ToolContext } from "../tool";
import { getAccountBinding } from "./get-account";
import { listDecksBinding } from "./list-decks";
import { BINDINGS } from "./index";
import { callTool } from "../registry";

// The two example bindings, run against fake capabilities: no database, no container.

const actor = {
  userId: UserId.of("1"),
  username: "jack",
  displayName: "Jack",
  isAdmin: false,
  canSelfFund: false,
  mustChangePassword: false,
} as Actor;

function contextWith(capabilities: object): ToolContext {
  return {
    actor,
    scopes: ["read"],
    allows: () => true,
    container: { capabilities } as unknown as ToolContext["container"],
  };
}

describe("list_decks binding", () => {
  it("presents the decks the capability returns", async () => {
    const context = contextWith({
      listDecks: async () =>
        ok([
          {
            id: 4,
            name: "Elves",
            format: "commander",
            cards: 99,
            short: 2,
            usesRealCards: false,
            visibility: "private",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
    });
    const result = await callTool(context, "list_decks", {});
    expect(result).toEqual({
      kind: "outcome",
      outcome: {
        ok: true,
        value: {
          decks: [
            {
              id: 4,
              name: "Elves",
              format: "commander",
              cards: 99,
              short: 2,
              usesRealCards: false,
              visibility: "private",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
    });
  });
});

describe("get_account binding", () => {
  it("presents balance, allowance and totals in cents", async () => {
    const next = new Date("2026-02-01T00:00:00Z");
    const context = contextWith({
      getAccountOverview: async () =>
        ok({
          balanceCents: 5000,
          allowance: { amountCents: 1000, everyDays: 7, next },
          collection: { differentCards: 1, copies: 2, valueCents: 12 },
          decks: 3,
          wishes: 0,
        }),
    });
    const result = await callTool(context, "get_account", {});
    expect(result).toEqual({
      kind: "outcome",
      outcome: {
        ok: true,
        value: {
          player: { username: "jack", displayName: "Jack" },
          scopes: ["read"],
          balance: 5000,
          allowance: { amount: 1000, everyDays: 7, next: next.toISOString() },
          collection: { differentCards: 1, copies: 2, value: 12 },
          decks: 3,
          wishes: 0,
        },
      },
    });
  });

  it("refuses a token without the scope", async () => {
    const context = { ...contextWith({}), allows: () => false };
    expect(await callTool(context, "get_account", {})).toMatchObject({
      kind: "problem",
      problem: { kind: "MissingScope" },
    });
  });
});

describe("the bindings list", () => {
  it("has unique names and a flat input each", () => {
    expect(BINDINGS.map((binding) => binding.name)).toEqual([
      "get_account",
      "get_cards",
      "get_deck",
      "list_decks",
      "manage_wishlist",
    ]);
    expect(getAccountBinding.input.shape).toEqual({});
    expect(listDecksBinding.input.shape).toEqual({});
  });
});
