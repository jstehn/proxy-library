import { err, ok, type Result } from "@/shared/kernel";
import { Password, Username } from "../domain/credentials";
import type { AccountDisabled, InvalidCredentials } from "../domain/errors";
import { isActive, toActor, type Actor } from "../domain/player";
import type { AccountsDependencies } from "./ports";

export type SignInInput = { username: string; password: string };
export type SignInError = InvalidCredentials | AccountDisabled;

/** Signs a player in and sets the session cookie. */
export function makeSignIn(dependencies: AccountsDependencies) {
  const { unitOfWork, identity } = dependencies;

  async function signIn(
    input: SignInInput,
    requestHeaders: Headers,
  ): Promise<Result<Actor, SignInError>> {
    // A malformed username or password can't match any account. Answer exactly as for a wrong
    // password, so the error never hints at which part was wrong.
    const username = Username.parse(input.username);
    const password = Password.parse(input.password);
    if (!username.ok || !password.ok) return err({ kind: "InvalidCredentials" });

    const userId = await identity.signIn(
      { username: username.value, password: password.value },
      requestHeaders,
    );
    if (!userId.ok) return userId;

    const player = await unitOfWork.run(async ({ players }) =>
      ok(await players.findById(userId.value)),
    );

    // Credentials without a player row (see design doc 02, section 5) can't sign in either.
    if (!player.ok || player.value === null) {
      await identity.endAllSessions(userId.value);
      return err({ kind: "InvalidCredentials" });
    }
    if (!isActive(player.value)) {
      await identity.endAllSessions(userId.value);
      return err({ kind: "AccountDisabled" });
    }
    return ok(toActor(player.value));
  }

  return signIn;
}
