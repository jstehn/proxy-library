# Architecture Decision Records

An ADR records **one** significant decision: the context, what we chose, and the consequences we
accept. ADRs are immutable once accepted. To change a decision, write a new ADR that
**supersedes** the old one.

Template: [`TEMPLATE.md`](TEMPLATE.md).

| #    | Decision                                                                                     | Status   |
| ---- | -------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Modular monolith with hexagonal modules](0001-modular-monolith.md)                          | Accepted |
| 0002 | [Functions + factory DI, one composition root](0002-factory-di.md)                           | Accepted |
| 0003 | [Result types for expected failures](0003-result-types.md)                                   | Accepted |
| 0004 | [Append-only ledger for money](0004-append-only-ledger.md)                                   | Accepted |
| 0005 | [Unit of Work across modules](0005-unit-of-work.md)                                          | Accepted |
| 0006 | [CQRS-lite: query functions for reads](0006-cqrs-lite-reads.md)                              | Accepted |
| 0007 | [External data behind an anti-corruption layer](0007-external-data-acl.md)                   | Accepted |
| 0008 | [Server-side, injectable randomness and time](0008-injected-rng-clock.md)                    | Accepted |
| 0009 | [Lint-enforced architecture boundaries](0009-lint-enforced-boundaries.md)                    | Accepted |
| 0010 | [Nix flake + direnv dev environment](0010-nix-dev-environment.md)                            | Accepted |
| 0011 | [Track cards at printing × finish granularity](0011-printing-level-ownership.md)             | Accepted |
| 0012 | [Better Auth for identity only, behind a port](0012-better-auth-identity-only.md)            | Accepted |
| 0013 | [Daily price history and a store transaction ledger](0013-price-history-and-store-ledger.md) | Accepted |
| 0014 | [Price singles at market value and sealed product at MSRP](0014-pricing-sources.md)          | Accepted |
