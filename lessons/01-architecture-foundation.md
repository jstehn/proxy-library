# Lesson 01: Designing with types and dependencies

- **Phase:** 1 (architecture foundation)
- **Prerequisites:** [Lesson 00](00-dev-environment.md): TypeScript basics, unions, narrowing
- **Time:** 2–3 hours, best split across the three parts
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Read and write TypeScript **type aliases**, **generics** and **overloads**, and explain how each
   differs from a Python class or function.
2. Model "success or failure" with a **discriminated union** (`Result`) and let the compiler force
   callers to handle both.
3. Use **branded types** to make mix-ups like "cents vs. count" impossible to compile.
4. Explain **ports and adapters** and implement **dependency injection** with factory functions and
   a composition root.
5. Explain what a **unit of work** guarantees and how ours turns a `Result` into commit or rollback.
6. **Parse, don't validate**: turn untrusted input into trusted types at the boundary.
7. Choose between **unit, property-based, statistical and integration** tests.
8. Describe how **lint rules** keep an architecture from eroding.

The lesson has three parts:

- **Part A: Types as a design tool** (objectives 1–3)
- **Part B: Designing with dependencies** (objectives 4–6)
- **Part C: Keeping it correct** (objectives 7–8)

---

# Part A: Types as a design tool

## A1. Type aliases name shapes; they aren't classes

```ts
export type Ok<T> = { readonly ok: true; readonly value: T };
```

`type` gives **a name to a shape**. It creates no class, no constructor, and nothing at runtime.
The objects themselves are plain object literals, which behave much like Python dicts:

```ts
const r = { ok: true, value: 42 }; // this plain object IS an Ok<number>
```

The closest Python is a `TypedDict`:

```python
class Ok(TypedDict, Generic[T]):
    ok: Literal[True]
    value: T
```

`readonly` stops a field from being reassigned after creation, much like a frozen dataclass.

One more thing the type does: `ok: true` means the field's type is the **literal** `true`, not
just any boolean. That detail is what makes section A3 work.

## A2. Generics: type placeholders

The `<T>` in `Ok<T>` is a **type parameter**: a placeholder that whoever uses the type fills in.

```ts
Ok<number>; // = { ok: true; value: number }
Ok<Cents>; // = { ok: true; value: Cents }
```

Functions can have type parameters too. They then have **two parameter lists**:

```ts
function ok<T>(value: T): Ok<T>;
//         ^^^ ^^^^^^^^   ^^^^^
//          |      |        └ uses T: the return type
//          |      └ uses T: the argument's type
//          └ DECLARES T (type parameters are resolved by the compiler)
```

- `<…>` holds **type** parameters. They exist only for the compiler.
- `(…)` holds **value** parameters. They exist at runtime.

`<T>` must come first because it's where `T` is created. `(value: T)` then uses it. Python 3.12
has the same syntax (`def ok[T](value: T) -> Ok[T]`). Older Python splits it into two steps:
`T = TypeVar("T")` declares the placeholder, and the function signature then uses it.

### Why not just `any`?

The placeholder's job is to **connect** the input type to the output type:

```ts
function okAny(value: any): Ok<any>;
okAny(42).value.toUpperCase(); // compiles, then crashes: `any` switches checking off

function okUnknown(value: unknown): Ok<unknown>;
okUnknown(42).value + 1; // ❌ the compiler has forgotten it was a number

function ok<T>(value: T): Ok<T>;
ok(42).value + 1; // ✅ T was inferred as number
ok(42).value.toUpperCase(); // ❌ caught at compile time
```

Usually the compiler **infers** `T` from the argument (`ok("hi")` gives `T = string`). You can also
pass it explicitly: `ok<number>(42)`.

> **Try it:** in any `.ts` file, hover over `ok(42)` in your editor and read the inferred type.

## A3. Union types and discriminated unions: `Result`

From [`src/shared/kernel/result.ts`](../src/shared/kernel/result.ts):

```ts
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;
```

The last line reads: "a `Result` is **either** an `Ok<T>` **or** an `Err<E>`." It's Python's
`Ok[T] | Err[E]`. `T` is the success type, and `E` is the error type. `E` isn't necessarily an
`Error` object. In this project it's usually a small description:

```ts
Result<Cents, { kind: "InsufficientFunds"; balance: Cents; required: Cents }>;
```

### Reading a function that returns a Result

```ts
type QuantityError = { kind: "NotANumber"; input: string } | { kind: "Negative"; value: number };

function parseQuantity(input: string): Result<number, QuantityError> {
  const value = Number(input);
  if (input.trim() === "" || !Number.isInteger(value)) return err({ kind: "NotANumber", input });
  if (value < 0) return err({ kind: "Negative", value });
  return ok(value);
}
```

The first line has three parts: the name, what it **takes** (`input: string`), and, after the `:`
that follows the `)`, what it **returns**. That return type is Python's `->`:
`def parse_quantity(input: str) -> Result[int, QuantityError]`.

`Result<number, QuantityError>` doesn't create anything for the function to use. It **fills in**
`Result`'s two placeholders, and substituting them shows exactly what the function promises to
return:

```ts
Result<number, QuantityError>
  = Ok<number> | Err<QuantityError>
  = { ok: true; value: number } | { ok: false; error: QuantityError }
```

`ok(...)` and `err(...)` are just shortcuts for building those two shapes. Without them, the
function reads:

```ts
function parseQuantity(input: string): Result<number, QuantityError> {
  const value = Number(input);
  if (input.trim() === "" || !Number.isInteger(value)) {
    return { ok: false, error: { kind: "NotANumber", input: input } }; // failure shape
  }
  if (value < 0) {
    return { ok: false, error: { kind: "Negative", value: value } }; // failure shape
  }
  return { ok: true, value: value }; // success shape
}
```

The compiler checks every `return` against the promised type. A misspelled `kind` or a
`value: "four"` is a compile error.

### Why this beats exceptions for expected failures

The `ok` field is a **discriminant**: a literal-typed field the compiler uses to tell the two
cases apart. Watch it narrow:

```ts
const r = debit(user, price); // Result<void, InsufficientFunds>
r.value; // ❌ r might be an Err, which has no `value`
if (!r.ok) {
  console.log(r.error.kind); // ✅ in here, r is Err
  return;
}
r.value; // ✅ past the check, r is Ok
```

You **cannot** use the success value without first dealing with the failure. With exceptions,
nothing in `debit`'s signature tells you it can fail, and forgetting a `try` compiles fine. That's
why [ADR 0003](../docs/adr/0003-result-types.md) uses `Result` for **expected** failures and keeps
exceptions for real bugs and outages.

## A4. Overloads: one function, several call shapes

We want `ok()` (nothing to return) and `ok(value)` to have precise types. From `result.ts`:

```ts
export function ok(): Ok<void>; // (a) call shape, no body
export function ok<T>(value: T): Ok<T>; // (b) call shape, no body
export function ok<T>(value?: T): Ok<T | undefined> {
  // (c) the one real implementation
  return { ok: true, value };
}
```

- (a) and (b) end in `;`. They're **declarations for callers** and produce no code.
- (c) is the implementation, and callers can't see its signature. `value?: T` makes the argument
  optional, so inside it `value` might be `undefined`. Hence `Ok<T | undefined>`.
- `{ ok: true, value }` is shorthand for `{ ok: true, value: value }`.

| Call      | Matches | Type         |
| --------- | ------- | ------------ |
| `ok()`    | (a)     | `Ok<void>`   |
| `ok(42)`  | (b)     | `Ok<number>` |
| `ok("x")` | (b)     | `Ok<string>` |

Without the overloads, `ok(42)` would be typed `Ok<number | undefined>`, and every caller would
have to handle an `undefined` that can't happen. The Python equivalent is `typing.overload`: several
decorated stubs followed by one implementation.

## A5. Exhaustiveness: making "I forgot a case" a compile error

When you `switch` over a union, you want the compiler to complain if a new variant is added and not
handled. From [`assert-never.ts`](../src/shared/kernel/assert-never.ts):

```ts
export function assertNever(value: never, message = "Unhandled variant"): never { throw … }
```

`never` is the type with **no possible values**. In a `switch` that has handled every case, the
leftover type in `default` _is_ `never`, so the call compiles. Add a variant without a `case`, and
the leftover isn't `never` any more, so the build fails. See exercise 1.

## A6. Branded types: stopping mix-ups the compiler can't see

TypeScript is **structural**: two types with the same shape are interchangeable. Cents and a card
count are both `number`, so this compiles and is wrong:

```ts
function refund(amount: number) { … }
refund(cardCount);   // oops
```

A **brand** adds a compile-time-only marker. From [`brand.ts`](../src/shared/kernel/brand.ts) and
[`money.ts`](../src/shared/kernel/money.ts):

```ts
declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
export type Cents = Brand<number, "Cents">;
```

- `&` is an **intersection**: "a `number` that _also_ has this property."
- `unique symbol` is a property key nobody else can ever write, and `declare` means it exists
  only in the type system. At runtime a `Cents` is a plain number, at zero cost.
- A raw `42` doesn't have the brand, so it can't be passed where `Cents` is expected. The only way
  in is a **smart constructor** that validates: `Cents.of(42)`.

The Python equivalent is `NewType("Cents", int)` checked by mypy.

### Companion objects: a value object without a class

```ts
export type Cents = Brand<number, "Cents">; // the TYPE
export const Cents = { of, fromUsd, add, format }; // a VALUE with the same name
```

TypeScript keeps types and values in separate namespaces, so one name can be both. Call sites
read like a class with static methods (`Cents.add(a, b)`, `Cents.format(c)`), but it's just an
object of functions: no `new`, no `this`, nothing to inherit.

> **Try it:** in a scratch file, `Cents.add(Cents.of(100), 5)`. Read the error: `Argument of type
'number' is not assignable to parameter of type 'Cents'.`

---

# Part B: Designing with dependencies

A **dependency** is anything a piece of code needs from outside itself to do its job: the current
time, the database, randomness, another service. This part is about one question: **where should
a function get its dependencies from?** We'll build the answer up in small steps with a toy
example, then read the real code.

Terms in **bold** the first time they appear are defined in the [glossary](GLOSSARY.md).

## B1. The problem: code that grabs what it needs

Here's a tiny function that greets someone based on the time of day:

```ts
function greetingFor(name: string): string {
  const hour = new Date().getHours(); // reads the real clock
  const partOfDay = hour < 12 ? "morning" : "afternoon";
  return `Good ${partOfDay}, ${name}`;
}
```

Two bits of new syntax:

- `condition ? a : b` means "`a` if the condition is true, otherwise `b`". It's Python's
  `a if condition else b`.
- `` `Good ${partOfDay}` `` is a template string, Python's `f"Good {part_of_day}"`.

Now try to **test** it. What does it return? That depends on when you run the test, so the test
passes in the morning and fails in the afternoon. The function **reaches out and grabs** the real
clock, so nobody can hand it a different one.

The app has the same problem at a larger scale: "three weeks passed, so pay three allowances"
can't be tested if the code reads the real clock, and nothing can be tested without a live
database if the code imports one directly.

## B2. Step 1: pass the dependency in

The fix is to let the **caller** decide which clock to use:

```ts
function greetingFor(name: string, clock: Clock): string {
  const hour = clock.now().getHours();
  const partOfDay = hour < 12 ? "morning" : "afternoon";
  return `Good ${partOfDay}, ${name}`;
}

greetingFor("Ada", systemClock()); // real time, in the app
greetingFor("Ada", fixedClock("2026-01-01T09:00")); // always 9am, in a test → "Good morning, Ada"
```

What is `Clock`? It's an **interface**: a description of what a clock must be able to do. From
[`src/shared/kernel/clock.ts`](../src/shared/kernel/clock.ts):

```ts
export interface Clock {
  now(): Date;
}
```

"A `Clock` is anything with a `now` method that returns a `Date`." It's exactly a Python
`Protocol`. Anything with that shape counts, and nothing has to declare "I am a Clock". The
project has three things that fit:

| Implementation                 | Where                                                            | Used in |
| ------------------------------ | ---------------------------------------------------------------- | ------- |
| `systemClock()`                | [`shared/runtime`](../src/shared/runtime/index.ts)               | the app |
| `fixedClock("2026-01-01")`     | [`shared/kernel/testing`](../src/shared/kernel/testing/index.ts) | tests   |
| `manualClock(…)` + `advanceBy` | same                                                             | tests   |

Two names you'll see in the docs: the interface describing what's needed is called a **port**, and
each implementation is called an **adapter**. `Clock` is a port, and `systemClock` and
`fixedClock` are adapters.

### Reading function types

`now(): Date` inside the interface is **not a call**. Nothing inside a type is ever run. It
describes a property whose value is a **function** that takes no arguments and returns a `Date`.
These two spellings mean the same thing:

```ts
interface Clock {
  now(): Date;
} // "method" shorthand
interface Clock {
  now: () => Date;
} // "property holding a function"
```

In Python terms the property is a `Callable[[], datetime]`, not a `datetime`. You get a value only
when you **call** it (`clock.now()`), which is why the time is fresh every time.

A function that returns a **Promise** gives you its value only once you `await` it. `Promise<Date>`
is TypeScript's `Awaitable[datetime]`, and `async` functions always return a Promise.

## B3. Step 2: pass dependencies once, not on every call

Step 1 works, but every caller now has to pass the clock on every call. Real code needs several
dependencies (a database, a clock, settings), and the page that displays a greeting shouldn't have
to know about any of them.

The fix is to **supply the dependencies once, up front, and get back a ready-to-use function**.
You already know this trick from Python:

```python
def make_greeter(clock):
    def greeting_for(name):                        # an inner function...
        hour = clock.now().hour                    # ...that uses `clock` from the outer function
        part_of_day = "morning" if hour < 12 else "afternoon"
        return f"Good {part_of_day}, {name}"
    return greeting_for                            # hand the inner function back

greeting_for = make_greeter(clock=SystemClock())   # supply the clock ONCE
greeting_for("Ada")                                # then just call it
greeting_for("Grace")
```

`greeting_for` still has access to `clock` after `make_greeter` has finished. An inner function
that remembers variables from the function that created it is called a **closure**.

The TypeScript version has the same shape:

```ts
type GreeterDependencies = { clock: Clock };

function makeGreeter(dependencies: GreeterDependencies) {
  const { clock } = dependencies; // (1) unpack what was passed in

  function greetingFor(name: string): string {
    // (2) the inner function that does the work
    const hour = clock.now().getHours();
    const partOfDay = hour < 12 ? "morning" : "afternoon";
    return `Good ${partOfDay}, ${name}`;
  }

  return greetingFor; // (3) hand it back
}

const greetingFor = makeGreeter({ clock: systemClock() }); // supply the clock once
greetingFor("Ada"); // then just call it
```

Line (1) is **destructuring**: `const { clock } = dependencies;` means
`clock = dependencies["clock"]`. It pulls a named property out into its own variable.

A function like `makeGreeter`, whose job is to build and return another function, is called a
**factory function**. In this project they're always named `make…`. Handing code its dependencies
from outside, instead of letting it grab them, is called **dependency injection**.

If you'd rather think in classes, this is the same idea as:

```python
class Greeter:
    def __init__(self, clock):        # ← makeGreeter({ clock })
        self.clock = clock
    def __call__(self, name): ...     # ← the returned greetingFor
```

Both versions take the dependencies once and use them on every call. The project uses the
function version because it needs no `self` and no class.

### Closures can also hold changing state

`manualClock`, a test helper, uses a closure to keep a private, changeable variable:

```ts
export function manualClock(start: Date | string) {
  let current = new Date(start).getTime(); // only the functions below can see this

  return {
    now: () => new Date(current),
    advanceBy: (milliseconds: number) => {
      current += milliseconds;
    },
  };
}
```

`(x) => …` is an **arrow function**, TypeScript's lambda. Unlike Python's `lambda` it can span
several lines when it uses `{ }`. The project uses arrow functions for short helpers like these,
and named `function`s for anything bigger.

## B4. The real thing: `makeCheckHealth`, line by line

Now the real code reads just like `makeGreeter`. It's the health check behind `/api/health`, from
[`src/server/health.ts`](../src/server/health.ts). First, it names the shapes it works with:

```ts
/** What a successful health check reports. */
export type HealthReport = Readonly<{
  status: "ok";
  appTime: string;
  databaseTime: string;
}>;

/** Why a health check can fail. */
export type HealthError = Readonly<{
  kind: "DatabaseUnavailable";
  message: string;
}>;

/** The database operations a health check needs while a transaction is open. */
type HealthCheckServices = {
  system: {
    databaseTime(): Promise<Date>;
  };
};

/** Everything checkHealth needs from outside. It's passed in, never imported directly. */
export type CheckHealthDependencies = {
  unitOfWork: UnitOfWork<HealthCheckServices>;
  clock: Clock;
};
```

- `Readonly<{…}>` makes every property unchangeable after creation.
- `HealthCheckServices` says the check needs one thing from the database: a `system` object with a
  `databaseTime` function.
- `CheckHealthDependencies` lists the two dependencies: a **unit of work**, which runs code inside
  a database transaction (section B8), and a `Clock`.

Then the factory, with the same three steps as `makeGreeter`:

```ts
export function makeCheckHealth(dependencies: CheckHealthDependencies) {
  const { unitOfWork, clock } = dependencies; // (1) unpack

  async function checkHealth(): Promise<Result<HealthReport, HealthError>> {
    // (2) the work
    try {
      return await unitOfWork.run(async (services) => {
        const databaseTime = await services.system.databaseTime();
        const report: HealthReport = {
          status: "ok",
          appTime: clock.now().toISOString(),
          databaseTime: databaseTime.toISOString(),
        };
        return ok(report);
      });
    } catch (error) {
      // For a health check, an unreachable database is an expected answer, not a bug.
      return err({ kind: "DatabaseUnavailable", message: String(error) });
    }
  }

  return checkHealth; // (3) hand it back
}
```

Reading step (2):

- `async function checkHealth(): Promise<Result<HealthReport, HealthError>>` means "an async
  function that eventually returns either a `HealthReport` or a `HealthError`" (the `Result` type
  from section A3).
- `try { … } catch (error) { … }` is Python's `try: … except Exception as error: …`.
- `unitOfWork.run(async (services) => { … })` passes an arrow function **into** `run`. A function
  handed to another function to call later is a **callback**. `run` opens a transaction, calls our
  callback with the `services` for that transaction, and commits or rolls back depending on what
  the callback returns.
- Inside, we ask the database for its time, build a `report` with the type `HealthReport`, and
  return `ok(report)`.
- If anything throws (for example the database is down), `catch` turns it into
  `err({ kind: "DatabaseUnavailable", … })`, and the route answers `503` instead of crashing.

## B5. Where the real things get created: the composition root

Somebody has to create the real database and clock and pass them to `makeCheckHealth`. That
happens in exactly one place, [`src/server/core.ts`](../src/server/core.ts), called the
**composition root** (the spot where the program is "composed" from its parts):

```ts
const { db, close } = createDatabase(config.databaseUrl);
const clock = systemClock();

function servicesFor(transaction: DbExecutor) {
  return { system: makeSystemService(transaction) };
}

const unitOfWork = makeDrizzleUnitOfWork(db, servicesFor);

return { …, checkHealth: makeCheckHealth({ unitOfWork, clock }) };
```

`{ unitOfWork, clock }` is shorthand for `{ unitOfWork: unitOfWork, clock: clock }`.

A test is a second, tiny composition root that passes **fakes** instead, from
[`health.test.ts`](../src/server/health.test.ts):

```ts
const checkHealth = makeCheckHealth({
  unitOfWork: inMemoryUnitOfWork({
    system: { databaseTime: async () => new Date("2026-01-01T00:00:01Z") },
  }),
  clock: fixedClock("2026-01-01T00:00:00Z"),
});
```

**`checkHealth` itself is identical in both.** Only what gets passed in differs: the app gets a
real database and clock, the test gets a pretend database and a frozen clock. That's the whole
payoff of dependency injection. The test needs no database and no waiting, and runs in
milliseconds.

The app and the worker each have a small entry file that calls `buildCore`:

- [`src/server/container.ts`](../src/server/container.ts) for the Next.js app. It adds
  `import "server-only"`, which makes the build fail if browser code ever imports it, and keeps
  one copy alive across hot reloads.
- [`worker/container.ts`](../worker/container.ts) for background jobs (`pnpm worker health`).

## B6. Asking for only what you need

`makeCheckHealth` asks for a unit of work whose services contain only `system`. As the project
grows, the real services object will contain much more: `{ system, wallet, inventory, … }`.

It will still be accepted, because TypeScript uses **structural typing**: it checks that the
object has **at least** the properties asked for, and ignores extras. So each function can ask for
exactly what it uses and see nothing else. The health check can't accidentally touch the wallet,
because as far as its types know, there is no wallet.

(Design books call this the _Interface Segregation Principle_: depend on the smallest interface
you need.)

## B7. Case study: randomness you can replay

Pack opening needs randomness that's unpredictable to players but **reproducible** for debugging
and tests. [`rng.ts`](../src/shared/kernel/rng.ts) provides a **seeded** random number generator:

```ts
const rng = seededRng("pack-42");
rng.next(); // a number in [0, 1), always the same sequence for the same seed
```

- In the app, [`randomSeed()`](../src/shared/runtime/index.ts) gets 128 unpredictable bits from the
  operating system. The seed is saved with each opening, so any pack can be regenerated exactly.
- In tests, readable seeds (`"rarity-odds"`) make every run identical.
- `weightedPick` chooses in proportion to weights (mythic 1 : rare 7).
  `weightedSample(rng, options, k)` draws `k` _different_ items, which is how booster sheets work.

It's the same idea as the clock: the pack engine will be handed an `Rng` and never call
`Math.random` itself.

## B8. The unit of work: all or nothing

Buying a pack means **take money from the wallet** _and_ **add the pack to your inventory**. If
the second step fails after the first succeeded, the money has vanished. A database
**transaction** groups steps so they all succeed together (**commit**) or are all undone
(**rollback**). A **unit of work** is this project's wrapper around a transaction.

The interface, from [`unit-of-work.ts`](../src/shared/kernel/unit-of-work.ts):

```ts
export interface UnitOfWork<Services> {
  run<T, E>(work: (services: Services) => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
```

In words: `run` takes a callback called `work`, gives it the services for the open transaction,
and returns whatever `work` returned. The rule is **commit if `work` returns `ok`; roll back if it
returns `err` or throws**.

The Postgres implementation
([`shared/db/unit-of-work.ts`](../src/shared/db/unit-of-work.ts)) has one wrinkle. The database
library (Drizzle) rolls back only when the callback **throws** an error, but our code **returns**
`err` instead of throwing. So the implementation throws a private "signal" error when it sees
`err`, which makes Drizzle roll back, then catches that signal and returns the original `err`:

```ts
return await db.transaction(async (transaction) => {
  const result = await work(servicesFor(transaction));
  if (!result.ok) {
    failedResult = result;
    throw rollbackSignal; // → ROLLBACK
  }
  return result; // → COMMIT
});
```

`servicesFor(transaction)` is the function from `core.ts` in B5. It builds the services so that
all their database work happens inside this one transaction.

## B9. Parse, don't validate

Untrusted data (environment variables, form input, JSON from other services) should be
**converted into a trusted type once, at the boundary**, so nothing inside ever re-checks it.
From [`shared/config/index.ts`](../src/shared/config/index.ts):

```ts
const EnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection URL"),
});
export function loadConfig(env = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment configuration:\n…`);
  return { databaseUrl: parsed.data.DATABASE_URL, … };
}
```

**Zod** plays the role of Pydantic. After `loadConfig()` returns, `config.databaseUrl` is known to
be a valid string. A misconfiguration fails **at startup, with a clear message**, rather than as a
confusing error deep inside a query an hour later. `Cents.fromUsd` follows the same philosophy for
price strings.

---

# Part C: Keeping it correct

## C1. Four kinds of test

| Kind            | Question it answers                          | Example in this repo                                                               |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Unit**        | does this function do the right thing?       | [`health.test.ts`](../src/server/health.test.ts): the use case with fakes          |
| **Property**    | does a rule hold for _all_ inputs?           | [`money.test.ts`](../src/shared/kernel/money.test.ts): add/subtract are inverses   |
| **Statistical** | do random outcomes follow the intended odds? | [`rng.test.ts`](../src/shared/kernel/rng.test.ts): 1:7 weights give ≈12.5% mythics |
| **Integration** | does it work against the real database?      | [`unit-of-work.int.test.ts`](../src/shared/db/unit-of-work.int.test.ts)            |

### Property-based testing

Instead of hand-picking examples, you state a **rule** and let **fast-check** (TypeScript's
Hypothesis) generate hundreds of inputs looking for a counterexample:

```ts
it("add and subtract are inverses", () => {
  fc.assert(
    fc.property(cents, cents, (a, b) => {
      expect(Cents.subtract(Cents.add(a, b), b)).toBe(a);
    }),
  );
});
```

When a property fails, fast-check **shrinks** the input to the smallest failing case and prints a
seed so you can replay it.

### Statistical tests without flakiness

"Mythic 1 : rare 7" should give 12.5% mythics. The test draws 80,000 times and allows ±0.5
percentage points. That tolerance is more than four standard errors wide, so correct code
essentially never fails. And because the seed is fixed, the result is deterministic anyway.

### Unit vs. integration

Vitest runs two **projects** ([`vitest.config.ts`](../vitest.config.ts)): `unit` (`*.test.ts`, no
database, milliseconds) and `integration` (`*.int.test.ts`, against the `tcg_test` database). Most
tests should be unit tests. That's only possible because Part B made the code injectable.

## C2. Architecture you can't accidentally break

An architecture that lives only in documents erodes one convenient import at a time.
[`eslint.config.mjs`](../eslint.config.mjs) turns the rules into lint errors:

1. **Every folder is classified** as an _element_: `kernel`, `db`, `server`, `app`, or a module
   layer such as `wallet/domain`.
2. **Allowed dependencies are listed** ("application may import its own domain and other modules'
   public API"), and everything else is `disallow`.
3. **Specific escapes are banned** outside the places allowed to use them: `Math.random`,
   `new Date()`, `process.env`, `fetch`, and import cycles.

```
Architecture: module-layer (demo/application) may not import module-layer (demo/infrastructure).
Inject an Rng instead of Math.random (ADR 0008).
Dependency cycle detected  import/no-cycle
```

The rules were verified by writing a deliberately bad module. Lint flagged every violation and
passed every legal import. With the ESLint extension installed in your editor, these errors show
up as you type.

## Common mistakes

| Mistake                                            | Why it happens                                             | Avoid it by                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Using `any` to "make the error go away"            | `any` switches type checking off for everything it touches | use a generic `<T>`, or `unknown` and narrow it (lint forbids `any`)        |
| Throwing for an expected failure                   | habit from Python                                          | return `err({ kind: … })`; throw only for bugs and outages                  |
| Calling `new Date()` or `Math.random()` in logic   | it's convenient                                            | take a `Clock` / `Rng` parameter (lint enforces this)                       |
| A module importing a global `db`                   | it's convenient                                            | receive it through the factory's `dependencies`                             |
| Casting with `as` to force a type                  | it silences the compiler without proving anything          | narrow with checks; `as` only inside smart constructors                     |
| Putting `import "server-only"` in shared code      | it seems safe                                              | it **throws outside Next.js** (worker, tests); keep it in the app container |
| Expecting per-project `env` in Vitest global setup | global setup runs in the main process, before test workers | read the variable explicitly (see `tests/setup/integration.ts`)             |

## Exercises

### 1. Exhaustive switch (warm-up)

```ts
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
```

Write `area(shape: Shape): number` using `switch (shape.kind)` and `assertNever` in `default`.
Then add `{ kind: "triangle"; base: number; height: number }` to `Shape` **without** adding a
case, and run `pnpm typecheck`.

<details><summary>Solution</summary>

```ts
import { assertNever } from "@/shared/kernel";

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.side ** 2;
    default:
      return assertNever(shape);
  }
}
```

After adding the triangle:

```
error TS2345: Argument of type '{ kind: "triangle"; base: number; height: number; }' is not
assignable to parameter of type 'never'.
```

The compiler points at exactly the place that needs a new `case`. Note that inside each `case`,
`shape` is narrowed, so `shape.radius` is only allowed in the circle branch.

</details>

### 2. Your first generic (warm-up)

Write `first<T>(items: readonly T[]): T | undefined` returning the first element. What type does
`first(["a", "b"])` have? What about `first([1, "a"])`?

<details><summary>Solution</summary>

```ts
function first<T>(items: readonly T[]): T | undefined {
  return items[0];
}
```

`first(["a", "b"])` is `string | undefined`. `first([1, "a"])` is `string | number | undefined`,
because `T` is inferred as the union of the element types. `readonly T[]` promises the function
won't modify the array, so it accepts both read-only and ordinary arrays.

</details>

### 3. Return a Result

Write `parseQuantity(input: string)` returning `Result<number, QuantityError>`, where
`QuantityError` is either `{ kind: "NotANumber"; input: string }` or
`{ kind: "Negative"; value: number }`. Non-integers count as `NotANumber`.

<details><summary>Hint</summary>

`Number(input)` gives `NaN` for garbage, and `Number.isInteger` rejects both `NaN` and `1.5`.
Watch out: `Number("")` is `0`.

</details>

<details><summary>Solution</summary>

```ts
import { err, ok, type Result } from "@/shared/kernel";

type QuantityError = { kind: "NotANumber"; input: string } | { kind: "Negative"; value: number };

function parseQuantity(input: string): Result<number, QuantityError> {
  const value = Number(input);
  if (input.trim() === "" || !Number.isInteger(value)) return err({ kind: "NotANumber", input });
  if (value < 0) return err({ kind: "Negative", value });
  return ok(value);
}
```

The declared return type tells `err(...)` which union to check against, so a typo like
`kind: "Negativ"` is a compile error.

</details>

### 4. Brands at work

Why doesn't `Cents.add(Cents.of(100), 5)` compile? What's the one legitimate fix, and why is it
better than `5 as Cents`?

<details><summary>Solution</summary>

`5` is a plain `number`, which lacks the brand:
`Argument of type 'number' is not assignable to parameter of type 'Cents'.` The fix is
`Cents.add(Cents.of(100), Cents.of(5))`. `Cents.of` **validates** (it rejects `5.5`, `NaN` and
unsafe integers), while `as Cents` would just silence the compiler without checking anything.

</details>

### 5. Control time in a test

Add a test to [`src/server/health.test.ts`](../src/server/health.test.ts) that calls `checkHealth`
twice, advancing a `manualClock` by one hour in between, and asserts each report's `appTime`.

<details><summary>Solution</summary>

```ts
import { inMemoryUnitOfWork, manualClock } from "@/shared/kernel/testing";

it("reports the current app time on each call", async () => {
  const clock = manualClock("2026-01-01T00:00:00Z");
  const checkHealth = makeCheckHealth({
    unitOfWork: inMemoryUnitOfWork({ system: { databaseTime: async () => clock.now() } }),
    clock,
  });

  const before = await checkHealth();
  clock.advanceBy(60 * 60 * 1000);
  const after = await checkHealth();

  expect(before.ok && before.value.appTime).toBe("2026-01-01T00:00:00.000Z");
  expect(after.ok && after.value.appTime).toBe("2026-01-01T01:00:00.000Z");
});
```

One hour of "waiting" takes zero milliseconds. This is exactly how Phase 3 will test weekly
allowances.

</details>

### 6. Write a property (challenge)

In [`rng.test.ts`](../src/shared/kernel/rng.test.ts), add a property: _for any list of weights
(0–5) containing at least one positive weight, `weightedPick` never returns an item whose weight
is 0._

<details><summary>Hint</summary>

Generate weights with `fc.array(fc.nat({ max: 5 }), { minLength: 1 })`. Use each index as the
item, and discard all-zero lists with `fc.pre(condition)`.

</details>

<details><summary>Solution</summary>

```ts
it("never picks a zero-weight item", () => {
  fc.assert(
    fc.property(fc.array(fc.nat({ max: 5 }), { minLength: 1 }), fc.string(), (weights, seed) => {
      fc.pre(weights.some((weight) => weight > 0));
      const options = weights.map((weight, item) => ({ item, weight }));
      const picked = weightedPick(seededRng(seed), options);
      expect(weights[picked]).toBeGreaterThan(0);
    }),
  );
});
```

`fc.pre` is a **precondition**: inputs that fail it are skipped, not counted as failures.

</details>

### 7. Predict the linter

Which of these imports are allowed? Answer first, then check against the rules in
`eslint.config.mjs` (or create the files and run `pnpm lint`).

1. `src/modules/wallet/domain/allowance.ts` imports `@/shared/kernel`
2. `src/modules/wallet/domain/allowance.ts` imports `drizzle-orm`
3. `src/modules/store/application/buy-sealed.ts` imports `@/modules/wallet`
4. `src/modules/store/application/buy-sealed.ts` imports `@/modules/wallet/domain/ledger`
5. `src/app/wallet/page.tsx` imports `@/shared/db`

<details><summary>Solution</summary>

1. ✅ Domain may import the kernel.
2. ❌ Domain must stay pure: no database libraries.
3. ✅ Another module's **public API** (`index.ts`) is allowed.
4. ❌ A deep import into another module's internals bypasses its public API.
5. ❌ The UI must go through the container and use cases, not the database directly.

</details>

### 8. Why rollback matters (discussion)

Suppose `UnitOfWork.run` committed even when `work` returned `err`. Describe what could go wrong
when buying a booster, step by step.

<details><summary>Solution</summary>

The buy use case debits the wallet, then adds the pack to inventory. If the inventory step
returns `err` (say, the product was just disabled) and the transaction still commits, the
**debit stays**: the player paid and received nothing. The ledger now contains a charge with no
matching purchase. Rolling back on `err` makes the two steps succeed or fail **together**.

</details>

## Recap

- `type` names a **shape**. It's erased at runtime, and objects are plain literals.
- `<T>` **declares** a type placeholder, and `(value: T)` **uses** it. Generics connect input
  types to output types, unlike `any`.
- A **discriminated union** (`Result`) plus narrowing forces callers to handle failure.
  **Overloads** give each call shape its exact type.
- **Brands** make "same shape, different meaning" mix-ups impossible to compile. **Companion
  objects** give them a constructor and operations without a class.
- **Ports** are Protocols. **Factory functions** inject dependencies through closures, and the
  **composition root** is the only place real adapters are created.
- A **unit of work** makes multi-step changes all-or-nothing: commit on `ok`, roll back on `err`.
- **Parse at the boundary** (Zod), then trust your types inside.
- Test pyramid: many **unit/property** tests, a few **integration** tests, with seeded randomness
  everywhere. **Lint** keeps the architecture from eroding.

## Further reading

- [Architecture overview](../docs/architecture/overview.md) and
  [pattern catalog](../docs/architecture/patterns.md) (patterns 2, 3, 5, 7, 8, 9, 17)
- ADRs: [0002 factory DI](../docs/adr/0002-factory-di.md), [0003 Result](../docs/adr/0003-result-types.md),
  [0005 unit of work](../docs/adr/0005-unit-of-work.md), [0008 Rng & Clock](../docs/adr/0008-injected-rng-clock.md),
  [0009 lint boundaries](../docs/adr/0009-lint-enforced-boundaries.md)
- TypeScript Handbook: [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html),
  [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- "Parse, don't validate", Alexis King (2019)
- fast-check documentation: <https://fast-check.dev>
