import { UserId } from "@/shared/kernel";
import type { Actor, ActorFields, AdminActor } from "../domain/player";

// Actors for tests. Production code can't build an `Actor` (it is branded, design doc 67), so
// every test that needs one asks for it here.

/** What a test may set. `name` fills the user id, username and display name in one go. */
export type ActorOverrides = Partial<ActorFields> & Readonly<{ name?: string }>;

/** A signed-in player. `testActor({ name: "alice" })` is `alice`; the default is `player`. */
export function testActor(overrides: ActorOverrides = {}): Actor {
  const { name = "player", ...fields } = overrides;
  const actor: ActorFields = {
    userId: UserId.of(name),
    username: name as ActorFields["username"],
    displayName: name as ActorFields["displayName"],
    isAdmin: false,
    canSelfFund: false,
    mustChangePassword: false,
    ...fields,
  };
  return actor as Actor;
}

/** An admin. `name` defaults to `admin`. */
export function testAdminActor(overrides: ActorOverrides = {}): AdminActor {
  return testActor({ name: "admin", ...overrides, isAdmin: true }) as AdminActor;
}
