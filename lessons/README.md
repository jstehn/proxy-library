# Lessons

A course in TypeScript and software design, taught through building this project. Each lesson
matches one phase of the [roadmap](../docs/roadmap.md) and assumes you know **Python and SQL**, so
new ideas are compared to their Python equivalents wherever one exists.

| #   | Lesson                                                                 | You'll learn                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00  | [Your development environment](00-dev-environment.md)                  | Nix + direnv, a project-local database, Next.js layout, first TypeScript and React                                                                                                 |
| 01  | [Designing with types and dependencies](01-architecture-foundation.md) | generics, unions, overloads, branded types, dependency injection, transactions, testing, lint-enforced architecture                                                                |
| 02  | [Authentication, authorization and forms](02-accounts-and-forms.md)    | sessions, cookies and password hashing, wrapping a library behind a port, race conditions and locks, compensating actions, Server Actions and forms, contract and end-to-end tests |
| 03  | [Money, time and a ledger](03-wallet-ledger-and-time.md)               | append-only ledgers, time as an input and property tests with dates, lazy and idempotent work, row locks, SQL `FILTER`, money and time zones at the edges                          |

New term you don't recognize? Check the [glossary](GLOSSARY.md).

## How to use a lesson

1. Read the **objectives** first, so you know what you're aiming for.
2. Work through the sections in order. Each builds on the previous one. Run every
   **Try it** as you go; they take seconds.
3. Do the **exercises**. Solutions are folded under each one. Try before you peek.
4. Finish with the **recap**. If any line in it isn't obvious, reread that section.

## Lesson format (for whoever writes the next one)

Lessons teach concepts. They aren't a changelog of what was built (that's what git history is
for). Every lesson follows this structure:

| Part             | Contents                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Header           | phase, prerequisites, rough time                                                                                             |
| Objectives       | 4–8 "you will be able to…" statements; every one is taught and exercised                                                     |
| Concept sections | ordered simple → complex. Each: the problem it solves → the idea → Python comparison → real code from this repo → **Try it** |
| Common mistakes  | pitfalls stated as general lessons (what goes wrong, why, how to avoid it)                                                   |
| Exercises        | graded warm-up → challenge, each with a hint and a folded `<details>` solution that has been verified to compile/pass        |
| Recap            | the key takeaways in a short list                                                                                            |
| Further reading  | ADRs, docs, and external references                                                                                          |

### Plain language rules

- **No unexplained jargon.** Define every term in plain words the first time it's used, and add
  it to [`GLOSSARY.md`](GLOSSARY.md).
- **Introduce new syntax explicitly** the first time it appears (`? :`, destructuring, arrow
  functions, …), with its Python equivalent.
- **Toy example first, real code second.** Build the idea up in small steps on something tiny,
  then read the project's code once every piece is familiar.
- **Walk through real code line by line** instead of summarizing it with abstract terms.

Code in lessons is quoted from the repo (with a link) or verified in a scratch file before
publishing. If the code changes later, update the lesson.
