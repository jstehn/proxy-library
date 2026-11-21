import { pick } from "@/shared/kernel";
import type { Social } from "./application/make-social";

// The social module's capabilities (ADR 0026): only what callers use.

export function wireSocialCapabilities({ social }: Readonly<{ social: Social }>) {
  return {
    social: pick(
      social,
      "updateProfile",
      "sendFriendRequest",
      "acceptFriendRequest",
      "declineFriendRequest",
      "cancelFriendRequest",
      "unfriend",
    ),
  };
}
