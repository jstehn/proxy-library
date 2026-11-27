# 0031. Give contents to sealed products MTGJSON hasn't filled in, from data files

- **Status:** Accepted
- **Date:** 2026-11-27
- **Extends:** 0007

## Context

MTGJSON takes sealed-product contents from a community repository where people write them by
hand. A product can be listed for weeks with no contents (Mystery Booster Commander Edition, sold
only at conventions, has had three products and no contents since 2026-10). The store never sells
a product with nothing inside (catalog rule 5b), so players couldn't buy something that exists.

## Decision

- A **data file per set** (`data/sealed-contents/<SET>.json`) gives contents to products MTGJSON
  lists with none. Same shape as MTGJSON's `contents`; a product inside another is named, not
  identified by uuid. Adding another set is adding a file, with no code change.
- It is read through a port (`ContentsOverridesSource`) by a gateway that checks it with Zod, and
  applied by a pure function in the sync before the broken-reference check.
- **Upstream wins:** only products with no contents are filled in. When MTGJSON catches up, the
  file stops mattering and can be deleted.
- The folder comes from `SEALED_CONTENTS_DIR` (default `data/sealed-contents`), so a deployment
  can add its own files without a rebuild.
- A bad file or entry is reported in the sync's `leftOut` list and skipped. It never stops a sync.
- Prices stay out of these files; an admin sets an MSRP override as for any product without one.

## Consequences

- Anyone can unblock a product with a small reviewed file, and send the same contents upstream.
- A wrong number in a file sells a wrong product, so each file's `note` says where its numbers
  came from.
- Cards inside products aren't supported (they need printing uuids); add that only when a real
  product needs it.
