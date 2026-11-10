import { preflight, registerClient } from "@/app/_oauth/http";

// RFC 7591 dynamic client registration (design doc 30): how claude.ai's connector introduces
// itself before sending you to the approval page.

export function POST(request: Request): Promise<Response> {
  return registerClient(request);
}

export const OPTIONS = preflight;
