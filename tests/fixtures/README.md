# Test fixtures

Small copies of **real** external data, so tests never call the network (design doc 04).

| File                           | Source                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `mtgjson/Meta.json`            | MTGJSON `Meta.json`, 2026-09-26 (version 5.3.0+20260926)                                                                                      |
| `mtgjson/SetList.json`         | MTGJSON `SetList.json`: only BLB, BLC, FDN, SPG, YBLB (online-only)                                                                           |
| `mtgjson/BLB.json`             | MTGJSON `BLB.json`, trimmed: 28 real cards, the `play` booster with every sheet cut down to those cards, 6 real sealed products, 3 real decks |
| `mtgjson/SPG.json`             | MTGJSON `SPG.json`: the 2 Special Guests the trimmed play booster uses                                                                        |
| `scryfall/default-cards.jsonl` | Scryfall `POST /cards/collection` for the same printings (2026-09-27), in the bulk file's one-card-per-line format                            |

Trimming kept everything consistent: every booster sheet, product and deck only refers to cards
that are in the fixtures. Sheet `totalWeight`s were recomputed. Heavy fields the app never reads
(translations, rulings, purchase links) were removed.

`mtgjson/BLC.json` is Bloomburrow Commander's real identity (code, type, parent set) with its
cards, decks and products **trimmed to nothing**. It exists because enabling BLB now enables its
Commander companion set (design doc 04, rule 11), and the fixture sync needs a file to read.

| `wpn/*.html` | Wizards Play Network product pages for Bloomburrow, Secrets of Strixhaven, Final Fantasy and Innistrad: Midnight Hunt (an older page format) (2026-09-30), trimmed to what we read: the header block (key art) and Nuxt's embedded data (`__NUXT_DATA__`), kept verbatim (Prettier ignores them) |

`images/card.jpg` is a made-up 8 × 8 JPEG (a blue square, drawn by Chromium). It stands in for
card images: in the proxy PDF unit tests, and in the browser tests' image cache, so making a proxy
PDF there never downloads an image.

**Added by hand** (real data): `BLB.json` also has **Wick, the Whorled Mind** (#120), whose cost is
only {3}{B} but whose rules text has {U}{B}{R}, so its color identity is Grixis: the deck builder's
identity filter is tested with it (design doc 14). It has no Scryfall line, so it has no price or
image, like a card Scryfall hasn't caught up with.

**Synthetic additions** (made up on purpose, to test the filters):

- `BLB.json`: an Alchemy-style card (`uuid 00000000-a1c4-…`, `availability: ["arena"]`) used only
  by a trimmed `play-arena` booster. Both must be excluded (design doc 04, rule 9).
- `default-cards.jsonl`: the same Alchemy card with `digital: true`, and a Spanish (`lang: "es"`)
  copy of a real card. Both must be ignored.
- A **Japanese-only Beza** (`BLB.json` uuid `00000000-7a9a-…-0001`, collector number 900, foil
  only; `default-cards.jsonl` id `00000000-7a9a-…-00bb`, `lang: "ja"`). It must get its image
  and price, like the real Japanese-only Mystical Archive cards (design doc 04, rule 8).

Regenerate with `scripts/fixtures/make-catalog-fixtures.py` (needs freshly downloaded
`BLB.json.gz`, `SPG.json.gz` and `SetList.json.gz`).
