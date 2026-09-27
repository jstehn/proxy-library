# Design: <module / phase name>

- **Phase:** N
- **Status:** Draft → In review → **Approved** (implementation starts only after approval)
- **Related ADRs:** 000X, 000Y

## 1. Purpose & scope

What this module is responsible for, in two or three sentences. **Out of scope:** what it
explicitly does _not_ do (and which module does).

## 2. Ubiquitous language

| Term | Meaning in this codebase |
| ---- | ------------------------ |
|      |                          |

## 3. Domain model

Types (TypeScript sketches). Mark aggregates and value objects. Show discriminated unions in full.

```ts

```

## 4. Invariants

Numbered rules that must **always** hold. Each one maps to at least one test.

1.

## 5. Use cases

| Use case | Actor / authz | Input | Output | Errors (`kind`) | Transaction? |
| -------- | ------------- | ----- | ------ | --------------- | ------------ |
|          |               |       |        |                 |              |

## 6. Ports

Interfaces this module's application layer needs, and which adapters implement them.

```ts

```

## 7. State machines

Transition table (from → event → to), or "none".

## 8. Persistence

Tables owned by this module (columns, keys, indexes, constraints), plus the migration notes.

## 9. Read models (queries)

Screens and the view models they need.

## 10. Events emitted

Domain events recorded to the activity outbox, or "none".

## 11. Patterns applied

Which entries from [patterns.md](../architecture/patterns.md) apply here and why. Note any
deliberate deviation.

## 12. Test plan

- Domain unit/property tests:
- Use-case tests (fakes):
- Contract/integration tests:
- E2E touchpoints:

## 13. Open questions

Decisions needed from review.
