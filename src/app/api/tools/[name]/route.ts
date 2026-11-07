import { handleToolCall } from "@/app/_llm-tools/http";

// One LLM tool over plain HTTP (design doc 28), as described by /api/tools/openapi.json: POST the
// tool's input as JSON with `Authorization: Bearer pl_…`.

export async function POST(request: Request, context: RouteContext<"/api/tools/[name]">) {
  return handleToolCall(request, (await context.params).name);
}
