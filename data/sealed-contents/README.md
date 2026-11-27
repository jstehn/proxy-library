# Sealed contents overrides

MTGJSON sometimes lists a sealed product before anyone has written down what is inside. The store
never sells a product with no contents, so such a product stays hidden. A file here fills the gap.

- One file per set, named after the set code: `MBC.json`. Add a file to cover another set; no
  code changes.
- Same shape as MTGJSON's `contents`: `pack` (`set` + booster `code`), `sealed` (another product
  of the same set, by **name**, with a `count`), `deck` and `other`.
- Only products with **no** contents upstream are filled in. Once MTGJSON has contents the file
  has no effect, and can be deleted.
- Say where the numbers came from in `note`. If you can, send the same contents to
  [mtg-sealed-content](https://github.com/mtgjson/mtg-sealed-content) so everyone gets them.
- Set a different folder with `SEALED_CONTENTS_DIR` (default `data/sealed-contents`).
- Prices are not set here. A product with no official or kind price needs an MSRP override on the
  admin page before it sells.
- The nightly sync reports what it applied (`contentsOverridden`) and what it couldn't use (the
  `leftOut` list) on `/admin/catalog`.

See ADR 0031.
