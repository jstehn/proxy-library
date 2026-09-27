# Test fixtures

Small copies of **real** external data, so tests never call the network (design doc 04).

| File                           | Source                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `mtgjson/Meta.json`            | MTGJSON `Meta.json`, 2026-09-26 (version 5.3.0+20260926)                                                                                      |
| `mtgjson/SetList.json`         | MTGJSON `SetList.json`: only BLB, BLC, FDN, SPG, YBLB (online-only)                                                                           |
| `mtgjson/BLB.json`             | MTGJSON `BLB.json`, trimmed: 27 real cards, the `play` booster with every sheet cut down to those cards, 6 real sealed products, 3 real decks |
| `mtgjson/SPG.json`             | MTGJSON `SPG.json`: the 2 Special Guests the trimmed play booster uses                                                                        |
| `scryfall/default-cards.jsonl` | Scryfall `POST /cards/collection` for the same printings (2026-09-27), in the bulk file's one-card-per-line format                            |

Trimming kept everything consistent: every booster sheet, product and deck only refers to cards
that are in the fixtures. Sheet `totalWeight`s were recomputed. Heavy fields the app never reads
(translations, rulings, purchase links) were removed.

`mtgjson/BLC.json` is Bloomburrow Commander's real identity (code, type, parent set) with its
cards, decks and products **trimmed to nothing**. It exists because enabling BLB now enables its
Commander companion set (design doc 04, rule 11), and the fixture sync needs a file to read.

**Synthetic additions** (made up on purpose, to test the filters):

- `BLB.json`: an Alchemy-style card (`uuid 00000000-a1c4-…`, `availability: ["arena"]`) used only
  by a trimmed `play-arena` booster. Both must be excluded (design doc 04, rule 9).
- `default-cards.jsonl`: the same Alchemy card with `digital: true`, and a Spanish (`lang: "es"`)
  copy of a real card. Both must be ignored.

Regenerate with `scripts/fixtures/make-catalog-fixtures.py` (needs freshly downloaded
`BLB.json.gz`, `SPG.json.gz` and `SetList.json.gz`).
