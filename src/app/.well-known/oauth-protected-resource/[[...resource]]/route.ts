import { preflight, protectedResourceMetadata } from "@/app/_oauth/http";

// RFC 9728 (design doc 30): how to sign in to /api/mcp. Clients may ask at the bare path or with
// the resource's path after it (/.well-known/oauth-protected-resource/api/mcp); both answer.

export function GET(): Response {
  return protectedResourceMetadata();
}

export const OPTIONS = preflight;
