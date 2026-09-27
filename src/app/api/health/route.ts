import { getContainer } from "@/server/container";

// A controller: call the use case, map the Result to HTTP. No logic of its own.
export async function GET() {
  const result = await getContainer().checkHealth();
  if (result.ok) return Response.json(result.value);
  return Response.json({ status: "error", error: result.error }, { status: 503 });
}
