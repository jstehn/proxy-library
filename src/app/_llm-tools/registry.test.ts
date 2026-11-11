import { describe, expect, it } from "vitest";
import { parseSearch } from "@/shared/card-search";
import { cookbookQueries, cookbookText } from "./cookbook";
import { openApiDocument } from "./openapi";
import { inputJsonSchema, TOOLS } from "./registry";
import { money } from "./tool";

// The registry's promises (design doc 28): simple schemas (rule 9), the fixed list of write
// tools (rule 5), the same tools on both endpoints (rule 6), working examples (rule 15).

type JsonSchema = Record<string, unknown>;

/** Every schema inside a schema, the schema itself first. */
function allSchemas(schema: JsonSchema): JsonSchema[] {
  const children: JsonSchema[] = [];
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  if (properties) children.push(...Object.values(properties));
  if (schema.items && typeof schema.items === "object") children.push(schema.items as JsonSchema);
  return [schema, ...children.flatMap(allSchemas)];
}

describe("the tool registry", () => {
  it("has unique verb_noun names", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });

  it("writes only decks and the wishlist, with exactly these tools (rule 5)", () => {
    const writes = TOOLS.filter((tool) => !tool.readOnly).map((tool) => [tool.name, tool.scope]);
    expect(writes).toEqual([
      ["create_deck", "decks:write"],
      ["update_deck", "decks:write"],
      ["set_deck_entry", "decks:write"],
      ["arrange_headings", "decks:write"],
      ["replace_deck_list", "decks:write"],
      ["choose_printing", "decks:write"],
      ["add_wish", "wishlist:write"],
      ["update_wish", "wishlist:write"],
      ["remove_wish", "wishlist:write"],
    ]);
    for (const tool of TOOLS.filter((each) => each.readOnly)) expect(tool.scope).toBe("read");
  });

  it("keeps every input schema simple enough for small models (rule 9)", () => {
    for (const tool of TOOLS) {
      const schema = inputJsonSchema(tool);
      expect(schema.type, tool.name).toBe("object");
      for (const part of allSchemas(schema)) {
        expect(part, tool.name).not.toHaveProperty("anyOf");
        expect(part, tool.name).not.toHaveProperty("oneOf");
        expect(part, tool.name).not.toHaveProperty("allOf");
        // A union of types (`.nullable()` gives ["string", "null"]) trips up some models too.
        if ("type" in part) expect(typeof part.type, tool.name).toBe("string");
      }
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      for (const [field, property] of Object.entries(properties)) {
        expect(property.description, `${tool.name}.${field}`).toEqual(expect.any(String));
      }
    }
  });

  it("describes when to use each tool that has choices to make", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
    for (const name of ["search_for_deck", "analyze_cards", "get_deck", "replace_deck_list"]) {
      expect(TOOLS.find((tool) => tool.name === name)?.description).toContain("Use it when");
    }
  });

  it("gives search examples in the descriptions that parse with no notes (rule 15)", () => {
    for (const tool of TOOLS) {
      for (const match of tool.description.matchAll(/"search":"((?:[^"\\]|\\.)*)"/g)) {
        expect(parseSearch(JSON.parse(`"${match[1]}"`)).notes, tool.name).toEqual([]);
      }
    }
  });

  it("offers every tool in the OpenAPI document with the same input schema (rule 6)", () => {
    const document = openApiDocument("https://proxylib.example.com") as {
      paths: Record<
        string,
        {
          post: {
            operationId: string;
            requestBody: { content: Record<string, { schema: unknown }> };
          };
        }
      >;
    };
    expect(Object.keys(document.paths)).toEqual(TOOLS.map((tool) => `/api/tools/${tool.name}`));
    for (const tool of TOOLS) {
      const operation = document.paths[`/api/tools/${tool.name}`].post;
      expect(operation.operationId).toBe(tool.name);
      expect(operation.requestBody.content["application/json"].schema).toEqual(
        inputJsonSchema(tool),
      );
    }
  });
});

describe("the synergy cookbook (rule 15)", () => {
  it("has queries that all parse with no notes", () => {
    for (const query of cookbookQueries()) {
      expect(parseSearch(query.search).notes, query.search).toEqual([]);
    }
  });

  it("prints as Markdown", () => {
    expect(cookbookText()).toContain("## Treasure");
  });
});

describe("money", () => {
  it("gives cents and dollars", () => {
    expect(money(123)).toEqual({ cents: 123, text: "$1.23" });
    expect(money(123456)).toEqual({ cents: 123456, text: "$1,234.56" });
    expect(money(-5)).toEqual({ cents: -5, text: "-$0.05" });
  });
});
