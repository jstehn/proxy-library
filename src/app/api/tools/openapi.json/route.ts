import { openApiDocument } from "@/app/_llm-tools/openapi";
import { getContainer } from "@/server/container";

// The OpenAPI description of the LLM tools (design doc 28), for function-calling clients to
// import. Public: it describes the tools, and calling one still needs a token.

export async function GET(): Promise<Response> {
  return Response.json(openApiDocument(getContainer().config.appUrl));
}
