import { openApiDocument } from "@/app/_llm-tools/openapi";
import { readCapabilities } from "@/server/page-instance";

// The OpenAPI description of the LLM tools (design doc 28), for function-calling clients to
// import. Public: it describes the tools, and calling one still needs a token.

export async function GET(): Promise<Response> {
  const capabilities = readCapabilities();
  return Response.json(openApiDocument(capabilities.appUrl));
}
