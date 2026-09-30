# 0015. Official product photos and key art from Wizards Play Network pages

- **Status:** Accepted (with design doc 13, 2026-09-30)
- **Date:** 2026-09-30

## Context

The store showed generated packaging art because no official source of product photos had been
chosen, and retailer images (Amazon and similar) aren't ours to use. Wizards' Fan Content Policy
allows free fan content, including a login-only site for a private group, to use Wizards'
pictures and artwork, but not to use Magic's logos and trademarks on their own.

Neither MTGJSON nor Scryfall has product photos. Wizards Play Network (`wpn.wizards.com`),
Wizards' site for game stores, has a public page per set with a photo of every product and the
set's key art. It has no public API: the pages are built from Wizards' content service, whose
access token is embedded in the page for Wizards' own use.

## Decision

- Read each enabled set's **public WPN page** in `catalog/infrastructure` (a new `WpnGateway`),
  like MTGJSON and Scryfall behind ADR 0007's anti-corruption layer: HTML in, a validated
  `WpnSetPage` out.
- **Don't use the embedded content-service token.** It's credentials for Wizards' site, not an
  offered API.
- Accept images only from Wizards' own image host, download each once at display size, cache on
  disk, and show them unaltered.
- Be polite: at most one page request per second, only when a set is new, settling, missing its
  page, or on a full sync.

## Consequences

- Official photos for nearly every product players buy, and key art for every set.
- **Fragility:** a WPN redesign can break parsing. It fails safe (generated art), and the admin
  page and the opt-in remote test show it.
- Page addresses are guessed from set names, with an admin override for the rest.
- The site must show the Fan Content Policy notice (added with this change).
