# Lesson 02: Authentication, authorization and forms

- **Phase:** 2 (accounts & roles)
- **Prerequisites:** [Lesson 01](01-architecture-foundation.md): Result, branded types,
  factory functions, the unit of work
- **Time:** 2–3 hours, best split across the parts
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Explain the difference between **authentication** and **authorization**, and how passwords,
   **sessions** and **cookies** fit together.
2. Explain why a third-party library (Better Auth) is wrapped behind a port.
3. Write permission rules as small pure functions and use them in a use case.
4. Recognize a **race condition** ("check, then act") and prevent it with a database lock.
5. Explain a **compensating action**: undoing a step a transaction can't cover.
6. Build a form that calls a **Server Action**, shows errors with `useActionState`, and parses its
   input with Zod.
7. Tell **Server Components** from **Client Components**, and know when you need each.
8. Write a **contract test** and an **end-to-end test**.

---

# Part A: Who is this?

## A1. Two different questions

Every request the app handles has to answer two questions:

| Question            | Name               | In this project                                                  |
| ------------------- | ------------------ | ---------------------------------------------------------------- |
| _Who_ is this?      | **Authentication** | Better Auth checks the username and password, and keeps sessions |
| _What_ may they do? | **Authorization**  | our own rules in `accounts/domain/rules.ts` (`requireAdmin`, …)  |

Keeping these separate is the main idea of [ADR 0012](../docs/adr/0012-better-auth-identity-only.md):
a library does the security-sensitive "who", and the "what" stays in plain code we can read and
test.

## A2. Passwords are never stored

If the database held passwords, anyone who got a copy of it would have every password. Instead we
store a **password hash**: a one-way scramble. Here's the idea in Python:

```python
import hashlib, os

salt = os.urandom(16)                                             # random, stored with the hash
stored = hashlib.scrypt(b"secret-password", salt=salt, n=16384, r=8, p=1)

# At sign-in: scramble what they typed the same way and compare.
typed = hashlib.scrypt(b"secret-password", salt=salt, n=16384, r=8, p=1)
typed == stored   # True, yet the password itself was never saved
```

You can check a password against a hash, but you can't turn a hash back into the password.
**scrypt** is deliberately slow and memory-hungry, so guessing billions of passwords is too. Better
Auth uses scrypt, and the result lives in the `password` column of `auth_accounts`.

## A3. Sessions and cookies: staying signed in

HTTP has no memory: each request arrives with no idea who sent the last one. Staying signed in
works like a cloakroom ticket:

```
1. You sign in with username + password.
2. The server checks the password hash, then creates a SESSION: a row in auth_sessions with a
   long random token and the user's id.
3. The server sends the token back in a COOKIE ("better-auth.session_token=…").
4. Your browser automatically sends that cookie with every later request.
5. On each request the server looks the token up: "session found, this is player X".
6. Signing out (or an admin disabling you) deletes the session row, so the ticket stops working.
```

A **cookie** is a small value the browser stores and returns to the same site on every request.
It's like Flask's `request.cookies`, and the whole flow is what Django's `request.session`
does for you.

> **Try it:** sign in at <http://localhost:3000>, open your browser's developer tools →
> Application (Chrome) or Storage (Firefox) → Cookies, and find `better-auth.session_token`. Then
> run `psql -c "select token, user_id, expires_at from auth_sessions"`. The cookie's value
> contains the same token as one of the rows (plus a signature that proves the server issued it).

## A4. Wrapping a library behind a port

The app never calls Better Auth directly. The accounts use cases depend on an interface, the
`IdentityProvider` port from
[`accounts/application/ports.ts`](../src/modules/accounts/application/ports.ts):

```ts
export interface IdentityProvider {
  createUser(input: {…}): Promise<Result<UserId, UsernameTaken>>;
  signIn(input: {…}, requestHeaders: Headers): Promise<Result<UserId, InvalidCredentials>>;
  currentUserId(requestHeaders: Headers): Promise<UserId | null>;
  endAllSessions(userId: UserId): Promise<void>;
  // …
}
```

It has two implementations:

- [`betterAuthIdentityProvider`](../src/modules/accounts/infrastructure/better-auth-identity-provider.ts),
  the real one. It is **the only code in the app that imports Better Auth**. It also translates
  Better Auth's thrown errors into our `Result`s: a `401` becomes
  `err({ kind: "InvalidCredentials" })`.
- `inMemoryIdentityProvider` in [`testing/fakes.ts`](../src/modules/accounts/testing/fakes.ts), a
  pretend version for fast tests.

This buys three things. Tests don't need Better Auth. The library's quirks stay in one file. And
replacing the library one day would touch one adapter, not the whole app. It's lesson 01's
port-and-adapter idea applied to a real dependency.

`Headers` is the standard web type for request headers. Methods about "the current browser" take
them because that's where the session cookie travels.

---

# Part B: The rules, as code

## B1. Checked input: `Username.parse`

What a player types is untrusted. As in lesson 01, we parse it once into a branded type, from
[`domain/credentials.ts`](../src/modules/accounts/domain/credentials.ts):

```ts
export const Username = {
  parse(raw: string): Result<Username, UsernameInvalid> {
    const username = raw.trim().toLowerCase();
    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
      return err({ kind: "UsernameInvalid", reason: `must be 3–20 characters` });
    }
    if (!USERNAME_PATTERN.test(username)) {
      return err({ kind: "UsernameInvalid", reason: "may only contain letters, numbers, _ and -" });
    }
    return ok(username as Username);
  },
};
```

Lowercasing here is what makes "Jack" and "jack" the same account (rule 1 in the design doc).
Every error carries a `reason`, so the form can say exactly what's wrong.

## B2. Rules as pure functions

Each permission rule is a tiny function: facts in, yes or no out. From
[`domain/rules.ts`](../src/modules/accounts/domain/rules.ts):

```ts
/** Rule 6: there must always be at least one active admin. */
export function checkAdminChange(input: {
  target: Player;
  makeAdmin: boolean;
  activeAdminCount: number;
}): Result<void, LastAdmin> {
  const { target, makeAdmin, activeAdminCount } = input;
  const removesAnActiveAdmin = !makeAdmin && target.isAdmin && isActive(target);
  if (removesAnActiveAdmin && activeAdminCount <= 1) return err({ kind: "LastAdmin" });
  return ok();
}
```

It doesn't load anything; the caller passes the facts in. So testing it is just calling it with
different facts ([`rules.test.ts`](../src/modules/accounts/domain/rules.test.ts)), with no
database and no fakes.

## B3. A use case, step by step: `registerPlayer`

[`application/register-player.ts`](../src/modules/accounts/application/register-player.ts) ties the
rules together. Here's its shape with the details trimmed:

```ts
async function registerPlayer(input): Promise<Result<Player, RegisterPlayerError>> {
  // 1. Check what was typed (nothing is touched if this fails).
  const username = Username.parse(input.username);
  if (!username.ok) return username;
  // …same for displayName and password

  // 2. One transaction for everything that must succeed together.
  const result = await unitOfWork.run<Player, RegisterPlayerError>(async ({ players, invites }) => {
    await players.lockAccounts();                                 // Part C explains this
    const isFirstPlayer = (await players.countPlayers()) === 0;

    // 3. Everyone after the first needs an open invite.
    if (!isFirstPlayer) { /* find the invite → InviteRequired / InviteNotFound / InviteNotOpen */ }

    // 4. Create the credentials (Better Auth), then our player row, then use up the invite.
    const userId = await identity.createUser({ … });
    if (!userId.ok) return userId;                                // UsernameTaken
    created.userId = userId.value;
    await players.insert(newPlayer({ …, isAdmin: isFirstPlayer }));
    // mark the invite used…
    return ok(player);
  });

  if (!result.ok) await undoCreatedUser();                        // B4 explains this
  return result;
}
```

Two details are worth noticing.

**Order matters.** The invite is checked _before_ credentials are created, so a bad invite never
creates anything. The player row is inserted _before_ the invite is marked used, because the
invite's `used_by` column points at the player row, and the database refuses a pointer to a row
that doesn't exist yet.

**`run<Player, RegisterPlayerError>`.** This callback can fail in several ways
(`InviteRequired`, `UsernameTaken`, …). TypeScript can't combine several error kinds on its own:
it takes the first `err(...)` it sees and rejects the rest. So we name both types up front, which
also tells the reader what the transaction produces.

## B4. When a transaction can't cover everything: compensation

Better Auth saves new credentials using **its own** database connection, outside our transaction.
If inserting the player row then fails, rolling back our transaction does nothing to Better Auth's
write, and an account would be half-created.

The fix is a **compensating action**: remember what was created, and undo it by hand if a later
step fails.

```ts
const created: { userId: UserId | null } = { userId: null };  // filled in after createUser
try {
  const result = await unitOfWork.run(…);
  if (!result.ok) await undoCreatedUser();   // a later step returned err
  return result;
} catch (error) {
  await undoCreatedUser();                   // a later step threw
  throw error;
}

async function undoCreatedUser() {
  if (created.userId !== null) await identity.deleteUser(created.userId);
}
```

The integration test proves it works. A temporary database trigger makes every insert into
`players` fail, and the test then checks that no credentials were left behind
([`accounts.int.test.ts`](../src/modules/accounts/infrastructure/accounts.int.test.ts)).

---

# Part C: When two things happen at once

## C1. The race condition

Two admins, Ana and Ben, are the only admins. At the same instant, each clicks "Remove admin" on
the _other_. Without protection:

| Time | Ana's request                       | Ben's request                       |
| ---- | ----------------------------------- | ----------------------------------- |
| 1    | count active admins → **2**         | count active admins → **2**         |
| 2    | 2 > 1, so demoting Ben is allowed ✔ | 2 > 1, so demoting Ana is allowed ✔ |
| 3    | save: Ben is no longer admin        | save: Ana is no longer admin        |
|      | **Zero admins. Rule 6 is broken.**  |                                     |

Each request followed the rule correctly. The problem is the gap between **checking** (step 1) and
**acting** (step 3): the other request acted inside that gap. This "check, then act" pattern is
the classic **race condition**. The same thing could make two simultaneous "first" registrations
both become admin.

## C2. The fix: take turns

The accounts repository has `lockAccounts()`, from
[`drizzle-repositories.ts`](../src/modules/accounts/infrastructure/drizzle-repositories.ts):

```ts
async lockAccounts() {
  await db.execute(sql`select pg_advisory_xact_lock(${ACCOUNTS_LOCK_ID})`);
}
```

An **advisory lock** is a Postgres lock on a number of our choosing rather than on a table row.
The `xact` in the name means it's held until the transaction ends. Every use case that
counts-then-changes takes it first, so Ben's request **waits** at `lockAccounts()` until Ana's
transaction commits. Then Ben counts **1** admin and gets `LastAdmin`.

It's like a Python `threading.Lock`, except the database holds it, so it works across every server
process. With a handful of friends, the waiting is unnoticeable.

## C3. Proving it

[`accounts.int.test.ts`](../src/modules/accounts/infrastructure/accounts.int.test.ts) fires both
requests at once with `Promise.all` (TypeScript's `asyncio.gather`):

```ts
const results = await Promise.all([
  accounts.setAdmin(ana, { userId: ben, isAdmin: false }),
  accounts.setAdmin(ben, { userId: ana, isAdmin: false }),
]);
expect(results.filter((result) => result.ok)).toHaveLength(1);
expect(results.filter((result) => !result.ok)).toEqual([err({ kind: "LastAdmin" })]);
```

When this project was built, removing the `lockAccounts()` line made this test fail **5 out of 5
runs** (zero admins left). With the lock, it passes every time. Exercise 5 lets you see this
yourself.

---

# Part D: The web layer

## D1. Server Components and Client Components

Next.js components come in two kinds:

|              | **Server Component** (the default)             | **Client Component** (`"use client"`)             |
| ------------ | ---------------------------------------------- | ------------------------------------------------- |
| Runs         | on the server only; sends finished HTML        | on the server _and_ in the browser                |
| Can          | read the database, call use cases, use secrets | respond to typing and clicks, keep state          |
| Can't        | react to clicks or keep state in the browser   | touch the database or secrets                     |
| In this repo | every `page.tsx`, `site-header.tsx`            | `*-form.tsx`, `player-row.tsx`, `src/ui/form.tsx` |

A file becomes a Client Component when its first line is `"use client"`. Everything it imports is
sent to the browser too. That's why [`src/server/container.ts`](../src/server/container.ts)
starts with `import "server-only"`: if a Client Component ever imported the database by mistake,
the build would fail.

The rule of thumb: **Server Components by default**, and a small Client Component only for the
interactive bit (here, just the forms).

## D2. Server Actions: forms that call the server

A **Server Action** is a server function that a form can call directly. Its file starts with
`"use server"`. Ours are the controllers from the architecture docs, doing three things and
nothing more. From [`sign-in/actions.ts`](<../src/app/(auth)/sign-in/actions.ts>):

```ts
"use server";

export async function signInAction(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  // 1. Parse the form.
  const form = SignInForm.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!form.success) return { error: "Please fill in both fields.", username: "" };

  // 2. Call the use case.
  const result = await getContainer().accounts.signIn(form.data, await headers());

  // 3. Turn the Result into what the page shows.
  if (!result.ok) return { error: messageFor(result.error), username: form.data.username };
  redirect(result.value.mustChangePassword ? "/account/password" : "/");
}
```

In Python terms, it's a Flask view handling a POST, except you call it like a function instead of
wiring up a URL. `_previousState` has a leading underscore because this action doesn't use it (it
exists for D3).

## D3. Showing results in the form: `useActionState`

The form itself is a small Client Component,
[`sign-in-form.tsx`](<../src/app/(auth)/sign-in/sign-in-form.tsx>):

```tsx
"use client";

const initialState: SignInState = { error: null, username: "" };

export function SignInForm() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <form action={formAction}>
      <TextField label="Username" name="username" defaultValue={state.username} />
      <TextField label="Password" name="password" type="password" />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
```

`useActionState(action, initialState)` wires the form to the action:

1. On submit, React calls `signInAction(currentState, formData)` on the server.
2. Whatever the action returns becomes the new `state`, and the form re-renders with it: the
   error appears, and the username stays filled in.
3. `formAction` is what you give the `<form>`. `name="username"` on an input is how its value
   ends up in `formData.get("username")`.

`{state.error && <Alert …>}` is React's "render this only if": when `state.error` is `null`,
nothing is shown.

## D4. Why parse `FormData` with Zod

`formData.get("username")` isn't simply a string. Its type is `string | File | null`: `null` if
the field is missing, and `File` if someone posts a file there. Someone can send anything to a
server action, not just what your form produces. So we parse it (lesson 01, "parse, don't
validate"):

```ts
const SignInForm = z.object({ username: z.string(), password: z.string() });
const form = SignInForm.safeParse({ username: formData.get("username"), … });
if (!form.success) return { error: "Please fill in both fields.", … };
// from here on, form.data.username is a string
```

## D5. Every error gets a message, and the compiler checks

```ts
function messageFor(error: SignInError): string {
  switch (error.kind) {
    case "InvalidCredentials":
      return "That username and password don't match.";
    case "AccountDisabled":
      return "This account has been disabled. Ask an admin if you think that's a mistake.";
    default:
      return assertNever(error);
  }
}
```

This is lesson 01's exhaustive switch doing real work. If a new error kind is added to
`SignInError`, the build fails right here until someone writes its message (exercise 3).

Notice that wrong password and unknown username get the **same** message. Different messages
would let a stranger discover which usernames exist.

## D6. Guarding pages: a quick check, then the real one

There are two layers:

1. **[`src/proxy.ts`](../src/proxy.ts)** runs before every page. It only checks whether a session
   cookie is _present_ (no database lookup), and sends obviously signed-out visitors to
   `/sign-in`. It's quick, but a fake or expired cookie would get past it.
2. **`requireActor()` / `requireAdminActor()`** in
   [`src/server/session.ts`](../src/server/session.ts) runs in each page and action. It does the
   real lookup through the `getActor` use case (the session exists, the player exists and isn't
   disabled). A non-admin opening an admin page gets "not found".

And beneath both, every admin **use case** checks `requireAdmin(actor)` itself (rule 10). If a
page forgets its guard, the use case still refuses. Layered checks like this are called _defense
in depth_.

---

# Part E: Testing each level

## E1. Contract tests: are the fakes honest?

The use-case tests run against in-memory fakes. That's only trustworthy if the fakes behave like
the real repositories. [`testing/repository.contract.ts`](../src/modules/accounts/testing/repository.contract.ts)
defines one suite of expectations, and it runs **twice**:

```ts
// testing/in-memory-repositories.test.ts
describeRepositoryContracts("in memory", async () => ({ players: inMemoryPlayerRepository(), … }));

// infrastructure/drizzle-repositories.int.test.ts
describeRepositoryContracts("drizzle", async () => ({ players: drizzlePlayerRepository(db), … }));
```

If the fake and Postgres ever disagree (say, about counting disabled admins), one of the two runs
fails.

## E2. End-to-end tests: a real browser

[`tests/e2e/accounts.spec.ts`](../tests/e2e/accounts.spec.ts) uses **Playwright** to drive Chromium
through the whole journey from the design doc: the first visitor becomes admin, creates an
invite, a second browser registers with it, the admin disables that player, and they can't get
back in.

```ts
await page.getByLabel("Username").fill("jack");
await page.getByRole("button", { name: "Sign in" }).click();
await expect(page.getByText("This account has been disabled")).toBeVisible();
```

Tests find things **the way a person does**, by label, role and visible text, rather than by CSS
classes. So they keep working when the styling changes, and they double as an accessibility
check: a button without a readable name can't be found.

`pnpm test:e2e` starts its own copy of the app on port 3100, with its own emptied database
(`tcg_e2e`). The browsers come from Nix; see [testing.md](../docs/architecture/testing.md).

---

## Common mistakes

| Mistake                                                      | Why it happens                                      | Avoid it by                                                          |
| ------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| Checking permissions only in the page or with hidden buttons | it looks secure in the browser                      | check in the use case too (`requireAdmin`), as defense in depth      |
| "Count, then change" without a lock                          | it works when you test by hand, one click at a time | take the lock first; test with `Promise.all`                         |
| Different messages for "no such user" and "wrong password"   | it seems more helpful                               | one message for both, so usernames can't be discovered               |
| Assuming a library's writes join your transaction            | the transaction looks like it wraps everything      | check what connection it uses; compensate if it doesn't              |
| Using `formData.get(...)` as a string directly               | your own form always sends strings                  | parse with Zod; anyone can post anything to an action                |
| Putting `"use client"` on a page to fix an error             | it makes the error go away                          | keep pages as Server Components; move only the interactive part      |
| Defining a component inside another component                | it's convenient                                     | define it at the top level and pass props (see `ActionButton`)       |
| `@playwright/test` version differs from Nix's browsers       | `pnpm update` bumps it                              | keep it pinned to `nix eval --raw nixpkgs#playwright-driver.version` |

## Exercises

### 1. Find your session (warm-up)

Sign in to the dev app. Find the session cookie in your browser's developer tools, then find the
matching row in `auth_sessions` with `psql`. Now click "Sign out" and run the query again. What
changed?

<details><summary>Solution</summary>

The cookie `better-auth.session_token` contains the same token as one `auth_sessions` row (plus a
signature). After signing out, that row is gone. Your browser may still hold the old cookie value
for a moment, but it no longer matches anything, so the server treats you as signed out. This is
why deleting session rows (`endAllSessions`) instantly signs someone out everywhere.

</details>

### 2. Reserve some usernames

Make `Username.parse` reject `root` and `system` (in any capitalization) with the reason
`"is reserved"`, and add a test.

<details><summary>Hint</summary>

A `Set` of reserved names, checked after lowercasing and the pattern check. Reuse the existing
`UsernameInvalid` error kind.

</details>

<details><summary>Solution</summary>

In [`credentials.ts`](../src/modules/accounts/domain/credentials.ts):

```ts
const RESERVED_USERNAMES = new Set(["root", "system"]);

// …inside Username.parse, just before `return ok(...)`:
if (RESERVED_USERNAMES.has(username)) {
  return err({ kind: "UsernameInvalid", reason: "is reserved" });
}
```

A test in `credentials.test.ts`:

```ts
it("rejects reserved names in any case", () => {
  expect(Username.parse("ROOT")).toEqual({
    ok: false,
    error: { kind: "UsernameInvalid", reason: "is reserved" },
  });
  expect(Username.parse("rooty").ok).toBe(true);
});
```

The register form already shows `Username is reserved.`, because the message is built from
`reason`.

</details>

### 3. Let the compiler find the missing message

Add a new error kind to `RegisterPlayerError` in
[`register-player.ts`](../src/modules/accounts/application/register-player.ts), for example
`| { kind: "UsernameReserved" }`, and run `pnpm typecheck`. Where does it fail, and why there?
Undo it afterwards.

<details><summary>Solution</summary>

```
src/app/(auth)/register/actions.ts: error TS2345: Argument of type '{ kind: "UsernameReserved"; }'
is not assignable to parameter of type 'never'.
```

It fails at `assertNever(error)` in `messageFor`. Every other `case` has been handled, so the only
thing that can still reach `default` is the new kind, and `assertNever` accepts only `never`. The
compiler has found the exact line where a user-facing message is missing.

</details>

### 4. Test a rule with fakes

Add a test to [`accounts.test.ts`](../src/modules/accounts/application/accounts.test.ts): revoking
the same invite twice should fail the second time with
`{ kind: "InviteNotOpen", status: "revoked" }`.

<details><summary>Solution</summary>

```ts
it("can't revoke an invite twice", async () => {
  const admin = toActor(await register("admin"));
  const code = await inviteCodeFrom(admin);
  await accounts.revokeInvite(admin, { code });
  expect(await accounts.revokeInvite(admin, { code })).toEqual(
    err({ kind: "InviteNotOpen", status: "revoked" }),
  );
});
```

`register` and `inviteCodeFrom` are helpers already in that file. The test runs in milliseconds
because everything is in memory.

</details>

### 5. Watch the race happen

In [`manage-players.ts`](../src/modules/accounts/application/manage-players.ts), comment out
`await players.lockAccounts();` in `setAdmin`. Run
`npx vitest run --project integration -t "demoting each other"` a few times. Then **put the line
back** and run it again.

<details><summary>Solution</summary>

Without the lock, the test fails (it did 5 out of 5 times when this lesson was written): both
demotions succeed, and there are zero admins left. With the lock, the second request waits for
the first to commit, then counts one admin and gets `LastAdmin`, so the test passes.

Races depend on timing, so on some machines the unlocked version might occasionally pass. That's
exactly what makes race bugs dangerous: "it worked when I tried it" proves nothing. The test is
reliable because it creates the "at the same moment" situation on purpose with `Promise.all`.

</details>

### 6. Extend the browser test (challenge)

In [`tests/e2e/accounts.spec.ts`](../tests/e2e/accounts.spec.ts), right after Jack sees
"Welcome, Jack", check that Jack (a regular player) gets the "not found" page at
`/admin/players`, and that his header has no "Players" link. Run `pnpm test:e2e`.

<details><summary>Solution</summary>

```ts
await player.goto("/admin/players");
await expect(player.getByText("This page could not be found.")).toBeVisible();
await expect(player.getByRole("link", { name: "Players" })).toHaveCount(0);
```

`requireAdminActor()` calls `notFound()` for non-admins, which shows Next.js's standard 404 page,
and the header only renders admin links when `actor.isAdmin`. `toHaveCount(0)` asserts something
is _absent_.

</details>

## Recap

- **Authentication** ("who?") is Better Auth's job; **authorization** ("what may they do?") is our
  domain rules.
- Passwords are stored only as **scrypt hashes**. A **session** is a server-side row, and the
  **cookie** carries its token.
- Better Auth sits behind the `IdentityProvider` **port**, so it's imported in exactly one file.
- Rules are **pure functions** (`checkAdminChange`), and use cases compose them inside a unit of
  work.
- "Check, then act" is a **race condition**. An **advisory lock** makes such changes take turns,
  and `Promise.all` in a test proves it.
- When a step can't join the transaction, undo it by hand: a **compensating action**.
- **Server Components** by default; **Client Components** only for interactivity. **Server
  Actions** are our controllers: parse (Zod), call the use case, map the `Result`.
- `useActionState` carries an action's result back into the form.
- **Contract tests** keep fakes honest; **Playwright** checks the whole journey the way a person
  would.

## Further reading

- [Design doc 02: accounts](../docs/design/02-accounts.md), especially section 15, "Implementation
  notes"
- [ADR 0012: Better Auth for identity only](../docs/adr/0012-better-auth-identity-only.md)
- Next.js docs shipped with the project: `node_modules/next/dist/docs/01-app/02-guides/forms.md`
  and `…/authentication.md`
- React docs: [`useActionState`](https://react.dev/reference/react/useActionState)
- OWASP Password Storage Cheat Sheet (why slow hashes like scrypt)
- PostgreSQL docs: "Advisory Locks"
