import type { makeResetPlayer } from "./application/reset-player";

// The reset module's capability (ADR 0026): the one use case, for the account page and the admin.

export function wireResetCapabilities({
  resetPlayer,
}: Readonly<{ resetPlayer: ReturnType<typeof makeResetPlayer> }>) {
  return { resetPlayer };
}
