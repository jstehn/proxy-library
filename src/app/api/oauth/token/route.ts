import { exchangeToken, preflight } from "@/app/_oauth/http";

// The OAuth token endpoint (design doc 30): swaps an approval's code for an access token.

export function POST(request: Request): Promise<Response> {
  return exchangeToken(request);
}

export const OPTIONS = preflight;
