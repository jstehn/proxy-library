import { handleMcp } from "@/app/_llm-tools/http";

// The MCP endpoint for LLM clients (design doc 28): Streamable HTTP, stateless, signed in with
// a personal access token. Each POST is one exchange; there are no sessions to open or close.

export async function POST(request: Request): Promise<Response> {
  return handleMcp(request);
}

function notAllowed(): Response {
  return new Response("Use POST: this MCP server is stateless.", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export const GET = notAllowed;
export const DELETE = notAllowed;
