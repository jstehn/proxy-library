import { authorizationServerMetadata, preflight } from "@/app/_oauth/http";

// RFC 8414 (design doc 30): the app's OAuth endpoints. Some clients add a path after it; the
// app is one issuer, so every path answers the same.

export function GET(): Response {
  return authorizationServerMetadata();
}

export const OPTIONS = preflight;
