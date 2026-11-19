// One-off record of what each registered LLM tool returns today (P00, docs/refactor/packages).
// Rebuilt features are compared with these files; they're a guide, not a test.
//
// Run: DATABASE_URL=$TEST_DATABASE_URL pnpm exec tsx scripts/reference-outputs.ts
// It uses the integration test database and the fixture catalog (no network). Tools that call an
// outside service (EDHREC, Commander Spellbook, YouTube, Reddit, Scryfall rulings) are not called:
// their file holds the input schema and the reason.
import { mkdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { buildCore } from "@/server/core";
import { loadConfig } from "@/shared/config";
import { actor, close, db, loadFixtureCatalog, resetPlayers } from "../tests/integration/harness";
import { callTool, inputJsonSchema, TOOLS } from "../src/app/_llm-tools/registry";
import type { ToolContext } from "../src/app/_llm-tools/tool";

const OUTPUT_FOLDER = "docs/refactor/reference/tools";
const NETWORK_TOOLS: Record<string, string> = {
  edhrec_lookup: "calls EDHREC",
  find_combos: "calls Commander Spellbook",
  youtube_research: "calls YouTube",
  reddit_research: "calls Reddit and a search engine",
};

if (!loadConfig().databaseUrl.includes("_test")) {
  throw new Error(
    "Refusing to run against a non-test database. Set DATABASE_URL=$TEST_DATABASE_URL.",
  );
}

const core = buildCore(loadConfig());
const jack = actor("jack");
const context: ToolContext = {
  actor: jack,
  scopes: ["read", "decks:write", "wishlist:write"],
  allows: () => true,
  container: core,
};

/** Ids, fingerprints and timestamps vary between runs: replace them with placeholders. */
function scrub(value: unknown, ids: Map<number, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => scrub(item, ids));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => {
        if (/^(fingerprint|previewId)$/.test(key)) return [key, `<${key}>`];
        if (typeof inner === "number" && /^deckId$/.test(key)) return [key, "<deckId>"];
        if (typeof inner === "number" && ids.has(inner) && key === "id")
          return [key, ids.get(inner)];
        return [key, scrub(inner, ids)];
      }),
    );
  }
  if (typeof value === "string") {
    return value.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<timestamp>");
  }
  return value;
}

async function run(name: string, input: Record<string, unknown>) {
  const result = await callTool(context, name, input);
  if (result.kind === "problem") return { problem: result.problem };
  return result.outcome.ok ? { ok: true, value: result.outcome.value } : result.outcome;
}

async function main(): Promise<void> {
  await loadFixtureCatalog();
  await resetPlayers(["jack", "amy"]);
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${jack.userId}, p.id, 'nonfoil', 1 from printings p
     where p.name = 'Banishing Light' order by p.collector_number limit 1
  `);

  const created = await run("create_deck", {
    name: "Reference deck",
    list: "Commander\n1 Beza, the Bounding Spring\nDeck\n1 Banishing Light\n10 Plains\nMaybeboard\n1 Carrot Cake",
  });
  const deckId = (created as { value: { deckId: number } }).value.deckId;
  const ids = new Map([[deckId, "<deckId>"]]);
  const fresh = (await run("get_deck", { deckId })) as { value: { fingerprint: string } };

  const inputs: Record<string, Record<string, unknown>> = {
    get_account: {},
    list_decks: {},
    get_deck: { deckId, includeText: true, include: ["signals", "prices"] },
    create_deck: { name: "Another deck", format: "casual" },
    update_deck: { deckId, plan: "Go wide with tokens.", targetBracket: 2 },
    edit_deck: {
      deckId,
      fingerprint: fresh.value.fingerprint,
      changes: [{ card: "Plains", quantity: 8 }],
    },
    search_cards: { deckId, search: "t:enchantment", includePrice: true },
    get_cards: { cards: ["Banishing Light", "Plains"] },
    find_replacements: { card: "Banishing Light", deckId },
    draw_sample: { deckId, hands: 2 },
    rules_lookup: { query: "100.1" },
    manage_wishlist: { action: "list" },
  };

  mkdirSync(OUTPUT_FOLDER, { recursive: true });
  for (const tool of TOOLS) {
    const reason = NETWORK_TOOLS[tool.name];
    const record =
      reason !== undefined
        ? { tool: tool.name, notCalled: reason, inputSchema: inputJsonSchema(tool) }
        : {
            tool: tool.name,
            input: scrub(inputs[tool.name] ?? null, ids),
            output: scrub(await run(tool.name, inputs[tool.name] ?? {}), ids),
          };
    writeFileSync(`${OUTPUT_FOLDER}/${tool.name}.json`, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`wrote ${tool.name}${reason ? " (not called)" : ""}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await core.close();
    await close();
  });
