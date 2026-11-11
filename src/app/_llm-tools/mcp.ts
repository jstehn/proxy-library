import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { searchHelpText } from "@/shared/card-search";
import { cookbookText } from "./cookbook";
import { callTool, inputJsonSchema, INSTRUCTIONS, problemMessage, TOOLS } from "./registry";
import type { ToolContext } from "./tool";

// The MCP adapter (design doc 28, section 2): one MCP server per request (stateless), listing
// and calling the registry's tools for the token's player. Resources and prompts repeat what the
// tool descriptions already say, for clients that show them (rule 10).

const RESOURCES = [
  {
    uri: "proxylib://search-syntax",
    name: "Card search syntax",
    description: "Every keyword the card search understands, with examples.",
    text: searchHelpText,
  },
  {
    uri: "proxylib://synergy-cookbook",
    name: "Synergy cookbook",
    description: "Tested search patterns for common mechanics, as enablers and payoffs.",
    text: cookbookText,
  },
] as const;

type PromptArgument = Readonly<{ name: string; description: string; required: boolean }>;
type Prompt = Readonly<{
  name: string;
  description: string;
  arguments: readonly PromptArgument[];
  text(args: Readonly<Record<string, string | undefined>>): string;
}>;

const PROMPTS: readonly Prompt[] = [
  {
    name: "find_synergies",
    description: "Find cards that fit what a deck is doing, from your collection first.",
    arguments: [
      { name: "deckId", description: "The deck's id", required: true },
      { name: "goal", description: "What the deck is going for, if you know", required: false },
    ],
    text: (args) =>
      [
        `Help me find cards for deck ${args.deckId}${args.goal ? ` (${args.goal})` : ""}.`,
        "1. Call get_deck and read the commander's text and the deck's problems.",
        "2. Call analyze_cards on the deck to see what its cards keep doing.",
        "3. List 3-8 synergies, each split into enablers and payoffs.",
        "4. Call search_for_deck with one query per synergy. Rewrite queries that found nothing or were capped, and run again.",
        "5. Read the candidates' text and shortlist the best 10-15 with one reason each, owned cards first.",
        "6. Compare with suggest_for_deck for anything the queries missed.",
        "7. Ask me before changing the deck; then use set_deck_entry, and add_wish for cards to buy later.",
      ].join("\n"),
  },
  {
    name: "build_deck",
    description: "Build a new deck around a commander from your cards.",
    arguments: [
      { name: "commander", description: "The commander's name", required: true },
      {
        name: "budget",
        description: "How much to spend on store cards, e.g. $20",
        required: false,
      },
    ],
    text: (args) =>
      [
        `Build a Commander deck led by ${args.commander}, from my cards first${args.budget ? `, spending at most ${args.budget} on store cards` : ""}.`,
        "Create it with create_deck (commander on the Commander board), then follow the find_synergies steps, fill the role targets get_deck shows (ramp, draw, removal, wipe), and finish the mana base with lands in the deck's colors.",
        "Use budget_upgrades for purchases and add_wish for what I can't afford yet.",
      ].join("\n"),
  },
  {
    name: "improve_deck",
    description: "Look for cards a deck could cut, and replacements to consider.",
    arguments: [{ name: "deckId", description: "The deck's id", required: true }],
    text: (args) =>
      [
        `Improve deck ${args.deckId}.`,
        "Call get_deck, analyze_cards and rank_cuts; look for cards that don't fit what the deck does, or roles below target. rank_cuts gives ideas from simple checks: weigh them against the cards' text.",
        "Find replacements with search_for_deck and similar_cards, owned first; offer swaps as options with your reasons, and apply them with set_deck_entry only when I agree.",
      ].join("\n"),
  },
];

function asContent(value: unknown, isError: boolean): CallToolResult {
  const structured = (typeof value === "object" && value !== null ? value : { value }) as Record<
    string,
    unknown
  >;
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: structured,
    isError,
  };
}

/** An MCP server for one request, acting as the token's player. */
export function makeMcpServer(context: ToolContext): Server {
  const server = new Server(
    { name: "proxy-library", title: "Proxy Library", version: "1.0.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: inputJsonSchema(tool) as { type: "object" },
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(context, request.params.name, request.params.arguments);
    if (result.kind === "problem") {
      return asContent(
        { error: { ...result.problem, message: problemMessage(result.problem) } },
        true,
      );
    }
    const { outcome } = result;
    return outcome.ok ? asContent(outcome.value, false) : asContent({ error: outcome.error }, true);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map(({ uri, name, description }) => ({
      uri,
      name,
      description,
      mimeType: "text/markdown",
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = RESOURCES.find((each) => each.uri === request.params.uri);
    if (resource === undefined) throw new Error(`No resource ${request.params.uri}`);
    return { contents: [{ uri: resource.uri, mimeType: "text/markdown", text: resource.text() }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map(({ name, description, arguments: args }) => ({
      name,
      description,
      arguments: args.map((each) => ({ ...each })),
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = PROMPTS.find((each) => each.name === request.params.name);
    if (prompt === undefined) throw new Error(`No prompt ${request.params.name}`);
    return {
      description: prompt.description,
      messages: [
        {
          role: "user",
          content: { type: "text", text: prompt.text(request.params.arguments ?? {}) },
        },
      ],
    };
  });

  return server;
}
