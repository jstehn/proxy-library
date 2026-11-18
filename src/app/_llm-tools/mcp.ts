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
        "1. Call get_deck (include: ['facts', 'signals']) to read the commander, profile, and deck stats.",
        "2. Gather outside evidence (edhrec_lookup, find_combos, rules_lookup, youtube_research, reddit_research) and cite it.",
        "3. Call search_cards with deckId and synergy queries to check catalog availability and ownership.",
        "4. Fetch rules text for shortlisted candidates via get_cards, citing an outside source or rules text for every card, owned first.",
        "5. Ask me before changing the deck; then use edit_deck, and manage_wishlist for cards to buy later.",
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
        "Create it with create_deck (commander on the Commander board), gather outside evidence (edhrec_lookup, youtube_research, reddit_research, find_combos) and cite it, search with search_cards (deckId), fill role targets shown by get_deck, and use manage_wishlist for what I can't afford yet.",
      ].join("\n"),
  },
  {
    name: "improve_deck",
    description: "Look for cards a deck could cut, and replacements to consider.",
    arguments: [{ name: "deckId", description: "The deck's id", required: true }],
    text: (args) =>
      [
        `Improve deck ${args.deckId}.`,
        "Call get_deck (include: ['facts', 'signals', 'text']); gather outside evidence (edhrec_lookup, find_combos, rules_lookup) and cite it.",
        "Find replacements with search_cards and find_replacements, owned first; offer swaps citing an outside source or rules text, and apply them with edit_deck only when I agree.",
      ].join("\n"),
  },
];

function asContent(value: unknown, isError: boolean): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
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
