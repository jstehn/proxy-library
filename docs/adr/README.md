# Architecture Decision Records

An ADR records **one** significant decision: the context, what we chose, and the consequences we
accept. ADRs are immutable once accepted. To change a decision, write a new ADR that
**supersedes** the old one.

Template: [`TEMPLATE.md`](TEMPLATE.md).

| #    | Decision                                                                   | Status   |
| ---- | -------------------------------------------------------------------------- | -------- |
| 0001 | [Modular monolith with hexagonal modules](0001-modular-monolith.md)        | Proposed |
| 0002 | [Functions + factory DI, one composition root](0002-factory-di.md)         | Proposed |
| 0003 | [Result types for expected failures](0003-result-types.md)                 | Proposed |
| 0004 | [Append-only ledger for money](0004-append-only-ledger.md)                 | Proposed |
| 0005 | [Unit of Work across modules](0005-unit-of-work.md)                        | Proposed |
| 0006 | [CQRS-lite: query functions for reads](0006-cqrs-lite-reads.md)            | Proposed |
| 0007 | [External data behind an anti-corruption layer](0007-external-data-acl.md) | Proposed |
| 0008 | [Server-side, injectable randomness and time](0008-injected-rng-clock.md)  | Proposed |
| 0009 | [Lint-enforced architecture boundaries](0009-lint-enforced-boundaries.md)  | Proposed |
| 0010 | [Nix flake + direnv dev environment](0010-nix-dev-environment.md)          | Accepted |
