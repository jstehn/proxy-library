import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resourceMetadataUrl } from "@/app/_oauth/http";
import { getContainer } from "@/server/container";
import { makeMcpServer } from "./mcp";
import { callTool, problemMessage } from "./registry";
import type { ToolContext } from "./tool";

// The two endpoints' request handling (design doc 28, section 2): sign in with the bearer token,
// then hand the request to the MCP server or run one tool.

/** The caller, from `Authorization: Bearer pl_…`, or null (rule 1: every failure looks alike). */
export async function toolContextFor(request: Request): Promise<ToolContext | null> {
  const container = getContainer();
  const found = await container.accounts.actorFromToken(request.headers.get("authorization"));
  return found === null ? null : { actor: found.actor, scopes: found.scopes, container };
}

export function unauthorized(): Response {
  return Response.json(
    {
      error: {
        kind: "Unauthorized",
        message:
          "Send an access token as Authorization: Bearer pl_… (make one on your Account page in Proxy Library).",
      },
    },
    {
      status: 401,
      headers: {
        // Where a web connector finds out how to sign in with OAuth (design doc 30).
        "WWW-Authenticate": `Bearer realm="proxy-library", resource_metadata="${resourceMetadataUrl()}"`,
      },
    },
  );
}

/** POST /api/mcp: one stateless MCP exchange. */
export async function handleMcp(request: Request): Promise<Response> {
  const context = await toolContextFor(request);
  if (context === null) return unauthorized();
  const server = makeMcpServer(context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

/** POST /api/tools/<name>: the tool's input as the JSON body, its output as the answer. */
export async function handleToolCall(request: Request, name: string): Promise<Response> {
  const context = await toolContextFor(request);
  if (context === null) return unauthorized();
  let body: unknown = {};
  const text = await request.text();
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json(
        { error: { kind: "InvalidJson", message: "The body must be a JSON object." } },
        { status: 400 },
      );
    }
  }
  const result = await callTool(context, name, body);
  if (result.kind === "problem") {
    const status = { UnknownTool: 404, MissingScope: 403, InvalidInput: 400 }[result.problem.kind];
    return Response.json(
      { error: { ...result.problem, message: problemMessage(result.problem) } },
      { status },
    );
  }
  const { outcome } = result;
  return outcome.ok
    ? Response.json(outcome.value)
    : Response.json({ error: outcome.error }, { status: 422 });
}
