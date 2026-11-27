import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resourceMetadataUrl } from "@/app/_oauth/http";
import {
  formatServerTiming,
  runWithMetrics,
  setMetricClient,
  setMetricLabel,
  type MetricEntry,
  type MetricKind,
} from "@/server/observability";
import { readTool } from "@/server/read-tool";
import { makeMcpServer } from "./mcp";
import { callTool, problemMessage } from "./registry";

// The two endpoints' request handling (design doc 28, section 2): sign in with the bearer token,
// then hand the request to the MCP server or run one tool.

function mcpLabelFromPayload(payload: unknown): string {
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (typeof item !== "object" || item === null) return "mcp";
  const record = item as { method?: unknown; params?: unknown };
  if (typeof record.method !== "string" || record.method.length === 0) return "mcp";
  if (typeof record.params === "object" && record.params !== null && "name" in record.params) {
    const toolName = (record.params as { name?: unknown }).name;
    if (typeof toolName === "string" && toolName.length > 0) {
      return `mcp:${record.method}:${toolName}`;
    }
  }
  return `mcp:${record.method}`;
}

/** The MCP client's own name (sent once, in `initialize`), or else the request's User-Agent. */
function clientNameFrom(request: Request, payload: unknown): string {
  const item = Array.isArray(payload) ? payload[0] : payload;
  const params =
    typeof item === "object" && item !== null ? (item as { params?: unknown }).params : null;
  const clientInfo =
    typeof params === "object" && params !== null
      ? (params as { clientInfo?: unknown }).clientInfo
      : null;
  if (typeof clientInfo === "object" && clientInfo !== null && "name" in clientInfo) {
    const name = (clientInfo as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return request.headers.get("user-agent") ?? "";
}

function withServerTiming(response: Response, snapshot: MetricEntry): Response {
  const headers = new Headers(response.headers);
  headers.set("Server-Timing", formatServerTiming(snapshot));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function runObservedHttp(
  kind: MetricKind,
  label: string,
  work: () => Promise<Response>,
): Promise<Response> {
  const { result: response, snapshot } = await runWithMetrics({ kind, label }, work);
  return withServerTiming(response, snapshot);
}

function unauthorized(): Response {
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
  return runObservedHttp("mcp", "mcp", async () => {
    const payload = await request
      .clone()
      .json()
      .catch(() => null);
    setMetricLabel(mcpLabelFromPayload(payload));
    setMetricClient(clientNameFrom(request, payload));
    const context = await readTool(request);
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
  });
}

/** POST /api/tools/<name>: the tool's input as the JSON body, its output as the answer. */
export async function handleToolCall(request: Request, name: string): Promise<Response> {
  return runObservedHttp("tool", `tool:${name}`, async () => {
    setMetricClient(request.headers.get("user-agent") ?? "");
    const context = await readTool(request);
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
      const status = { UnknownTool: 404, MissingScope: 403, InvalidInput: 400 }[
        result.problem.kind
      ];
      return Response.json(
        { error: { ...result.problem, message: problemMessage(result.problem) } },
        { status },
      );
    }
    const { outcome } = result;
    return outcome.ok
      ? Response.json(outcome.value)
      : Response.json({ error: outcome.error }, { status: 422 });
  });
}
