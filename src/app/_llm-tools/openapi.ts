import { inputJsonSchema, INSTRUCTIONS, TOOLS } from "./registry";

// The registry as an OpenAPI 3.1 document (design doc 28, section 2): one POST operation per
// tool, its operationId the tool's name and its description the tool's full instructions, so a
// function-calling client turns each into a tool just like an MCP client would (rule 6).

const ERROR = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { kind: { type: "string" }, message: { type: "string" } },
      required: ["kind", "message"],
    },
  },
};

export function openApiDocument(appUrl: string): Record<string, unknown> {
  const paths = Object.fromEntries(
    TOOLS.map((tool) => [
      `/api/tools/${tool.name}`,
      {
        post: {
          operationId: tool.name,
          summary: tool.title,
          description: tool.description,
          "x-scope": tool.scope,
          requestBody: {
            required: true,
            content: { "application/json": { schema: inputJsonSchema(tool) } },
          },
          responses: {
            "200": {
              description: "The tool's result, as JSON.",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "401": {
              description: "No valid access token.",
              content: { "application/json": { schema: ERROR } },
            },
            "403": {
              description: "The token lacks this tool's scope.",
              content: { "application/json": { schema: ERROR } },
            },
            "422": {
              description: "An expected failure; the message says what to do next.",
              content: { "application/json": { schema: ERROR } },
            },
          },
        },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: { title: "Proxy Library tools", version: "1.0.0", description: INSTRUCTIONS },
    servers: [{ url: appUrl }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: "A personal access token (pl_…) from your Account page.",
        },
      },
    },
    paths,
  };
}
