# 0024. Sell at the official MSRP by default; make value-based pricing an admin switch

- **Status:** Accepted (decided by the user, 2026-11-10; design doc 33)
- **Date:** 2026-11-10
- **Amends:** ADR 0021

## Context

ADR 0021 raises every sealed product whose contents sell back for more than its price, so that
buying and reselling never pays. Most raises (473 on the local catalog) fix generic kind prices
on old sets, where they're needed. Ten fix products that have Wizards' own MSRP (Final Fantasy,
recent Commander decks), lifting them above the price printed on the box, which the player who
runs the server doesn't want by default.

## Decision

- The store has a **pricing mode**, set by an admin: **`msrp` (the default)** or **`value`**.
- In `msrp` mode, an **official MSRP is used as published**. Kind prices are still raised to the
  resale floor (ADR 0021), so a generic guess never undersells old sets. Overrides are as typed.
- In `value` mode, ADR 0021 applies in full: official MSRPs are raised too.

## Consequences

- ✅ Products sell at the price on the box unless an admin chooses otherwise.
- ✅ Old sets priced by a generic guess stay safe in both modes.
- ❌ In `msrp` mode, a few products with an official MSRP return more than they cost when their
  cards are sold back (10 on the local catalog, $0.46 to $64.63 each on average). The switch closes it.
- ❌ One more setting that every sealed price reads (the shared SQL fragment and `storePrice`).

## Alternatives considered

- **Keep ADR 0021 as it is:** prices above the box's MSRP, which is what prompted this.
- **Drop the floor altogether by default:** reopens the Alpha-at-$3.99 hole (19 products sell back
  for over ten times their price).
- **Raise an official MSRP only when contents sell back for over twice it:** a middle ground;
  kept as an alternative in design doc 33, question 1.
