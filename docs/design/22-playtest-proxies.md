# Design: playtest proxies (low-ink card style)

- **Phase:** 22
- **Status:** **Built** (approved 2026-10-06 with the decisions in section 13; implementation notes in section 14)
- **Related ADRs:** 0007 (external data), 0016 (client-safe module API)
- **Inspired by:** [playtestproxies.com](https://playtestproxies.com/)

## 1. Purpose & scope

Proxy PDFs (phase 14) print each card's full scan, which uses a lot of ink: black borders, dark
frames, full-bleed art. This phase adds a second **card style**, **Playtest**. The PDF draws each
card itself from the catalog's text: name, mana cost, art, type line, rules text and stats on a
white card. A light pattern of **stripes in the card's colours** shows its colour at a glance. The
art can print in **full colour**, **black and white**, as **edges only** (a Sobel filter, which
looks like a pencil sketch and uses the least ink), or not at all.

Your usual choice: **full-colour art on the striped background**. That's the default for the
Playtest style. Mana symbols are the real artwork from the **Mana** font, at the size they print
on a real card (section 3.4).

**Out of scope:** card-like fonts for names and rules text (Helvetica, as today), a "Block" frame variant, text-only accessibility layouts, cards in other languages, and saving
proxy options per user (the address remembers them, as today).

## 2. Ubiquitous language

| Term           | Meaning in this codebase                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Card style     | How a proxy is printed: `scan` (Scryfall's image, as today) or `playtest` (drawn by us from the card's text). |
| Art crop       | Scryfall's image of just the illustration, without frame or text (`art_crop`).                                |
| Art filter     | What happens to the art crop before printing: `color`, `grayscale`, `edges` or `none` (no art box).           |
| Edges (Sobel)  | An edge-detection filter: dark lines where brightness changes sharply, white everywhere else.                 |
| Colour stripes | Diagonal stripes in light tints of the card's colours, behind the card's frame.                               |
| Stripe colours | The colours the stripes show: the card's colours, or for a land, the colours of mana it makes (section 3.3).  |
| Card layout    | The boxes a playtest card is made of (title, art, type, text, stats) and the text placed in them.             |

## 3. The playtest card

### 3.1 Layout (2.5 × 3.5 in, top to bottom)

```
┌──────────────────────────────┐  thin black outline (the cut line)
│ Lightning Bolt           (R) │  title bar: name, mana cost on the right
│ ┌──────────────────────────┐ │
│ │                          │ │  art box: the art crop, cropped to fill (about 40% of the height)
│ │          (art)           │ │
│ └──────────────────────────┘ │
│ Instant                  M10 │  type line; set code on the right
│ ┌──────────────────────────┐ │
│ │ Lightning Bolt deals 3   │ │  text box: white, rules text; reminder text in italics;
│ │ damage to any target.    │ │  the font shrinks (8.5 pt down to 5 pt) until it all fits
│ └──────────────────────────┘ │
│ 146 · Christopher Moeller [3/3]  footer: collector number, artist; power/toughness,
└──────────────────────────────┘          loyalty or defence in a box on the right
```

- The **stripes** fill the card's background (the margins around the boxes and the bars). The
  text box and art box sit on white (or the art), so text stays easy to read.
- With **art filter `none`**, the art box disappears and the text box grows into its space.
- Names and type lines that are too long shrink (down to 6 pt) rather than wrap.

### 3.2 Art filters

All four work on the art crop, a JPEG Scryfall provides for every printing with an image.

| Filter      | What prints                                                                 | Ink            |
| ----------- | --------------------------------------------------------------------------- | -------------- |
| `color`     | the art as it is **(default)**                                              | most           |
| `grayscale` | the art in shades of grey (luminance: 0.299 R + 0.587 G + 0.114 B)          | black ink only |
| `edges`     | Sobel edges, inverted: dark outlines on white, faint areas cleaned to white | very little    |
| `none`      | no art box                                                                  | none           |

Filters are **pure functions on pixels** (`{ width, height, pixels: Uint8ClampedArray }` →
same), unit-tested on tiny hand-made images. JPEG decoding and encoding sit in an adapter.

### 3.3 Colour stripes

- One stripe colour per colour of the card, in a fixed order (W, U, B, R, G), alternating:
  a white-blue card prints white-ish and blue stripes. Tints are light (about 20% strength) to
  save ink; "white" is a pale cream so it shows on paper.
- **Colourless** cards (artifacts, Eldrazi): light grey stripes.
- **Lands** have no colour, so they use the **colours of mana they make** (`produced_mana`,
  already stored): a Plains shows white stripes, a dual land two colours, a land that makes any
  colour all five (section 14), and one that makes only colourless grey.
- **Double-faced cards** use each face's own mana cost; a back face without one (Delver's
  Insectile Aberration) uses the printing's colours.
- An option turns stripes **off** (a plain white card) for the least ink.

### 3.4 Mana symbols: the Mana font

The symbols come from **Mana** by Andrew Gioia ([`mana-font`](https://github.com/andrewgioia/mana)
on npm: the font is SIL OFL 1.1, its CSS MIT), the MTG symbol font used across the community.
pdf-lib embeds `mana.ttf` through `@pdf-lib/fontkit`, keeping only the glyphs used (a subset), so
the symbols stay sharp vector shapes at any print size.

The font's glyphs are one colour; Mana's own CSS (`.ms-cost .ms-shadow`) builds the familiar
coloured symbol from them, and we follow that recipe exactly:

- a **circle** filled with Mana's cost colour (W `#f0f2c0`, U `#b5cde3`, B `#aca29a`,
  R `#db8664`, G `#93b483`, generic and colourless `#beb9b2`), the **glyph** centred on it in
  near-black (`#111`), and a thin **drop shadow** down and to the left (`-0.06em 0.07em`), as on
  real cards;
- **hybrid** symbols (`{W/U}`, `{2/G}`, `{C/R}`) split the circle diagonally between the two
  colours, with each half's glyph at 55% size in its corner, as Mana's CSS places them; hybrid
  Phyrexian (`{G/U/P}`) the same with Phyrexian glyphs;
- symbols that aren't mana (`{T}`, `{Q}`, `{E}`, `{S}`, `{CHAOS}`, …) use the glyph Mana provides
  for them; `{T}` and `{Q}` sit on the grey circle like a cost, as Mana draws them.

A table maps each Scryfall symbol (`{W/U}`) to Mana's glyph (`\ue600` is `{W}`, from
`mana.css`). A test checks that **every** symbol in Scryfall's symbology list (recorded as a
fixture) has an entry, so a new symbol fails a test instead of printing as a blank.

**Sizes, measured on real cards** (Scryfall's 745 px wide scans, 11.7 px per mm):

| Where                       | Real card                                     | Playtest proxy                                     |
| --------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Mana cost (title bar)       | 35 px ≈ **3.0 mm** across, ~0.3 mm apart      | 3.0 mm (8.5 pt) circles, 0.3 mm gap, right-aligned |
| Rules text (`{T}: Add {G}`) | 24 px ≈ **2.0 mm**, about 0.8 × the text size | 0.8 × the current font size, sitting on the line   |

Rules-text symbols shrink with the text when a long card's font shrinks. Wrath of God (2XM) and
Llanowar Elves (M19) were the measured examples.

### 3.5 Cards with more than one face

| Layout                               | What prints                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Double-faced (transform, modal, …)   | each face as its own card; backs on mirrored back pages, as with scans today                                  |
| Split, adventure, flip, aftermath, … | one card: the first face, then a dividing line and the other face's name, cost, type and text in the text box |

## 4. Invariants

1. A playtest card never draws outside its 2.5 × 3.5 in box, except its stripes in the bleed (section 15).
2. All rules text is printed: if it doesn't fit at 5 pt, the text box takes space from the art box
   (down to none) rather than cutting text.
3. Stripe colours come only from the card's colours, or for lands from the mana they make; a card
   with neither has grey stripes.
4. Filters never change an image's size, and every output pixel is 0–255.
5. A missing art crop never stops the sheet: that card's art box is left empty, outlined.
6. The scan style behaves exactly as it does today.

## 5. Use cases

| Use case           | Actor / authz                  | Input                  | Output    | Errors (`kind`)  | Transaction? |
| ------------------ | ------------------------------ | ---------------------- | --------- | ---------------- | ------------ |
| Download proxy PDF | signed-in deck owner, as today | deck id, proxy options | PDF bytes | 404 if not found | no           |

New proxy options (in the address, like the existing ones):

```ts
type ProxyOptions = Readonly<{
  // ...the phase 14 options...
  style: "scan" | "playtest";
  artFilter: "color" | "grayscale" | "edges" | "none"; // playtest only
  stripes: "on" | "off"; // playtest only
}>;
```

Defaults: `style: "scan"` (unchanged, decision 1), `artFilter: "color"`, `stripes: "on"`.
The print form shows the two playtest options only when Playtest is chosen, with a "Preview one
card" link that opens a one-card PDF of the deck's first card in the chosen settings (drawn by the
same code), so you can check before printing a whole deck.

## 6. Ports

```ts
/** decks/application/ports.ts: the art crop next to the existing full-card image. */
type ProxyImages = Readonly<{
  image(printingId: string, face: "front" | "back"): Promise<Uint8Array | null>;
  artCrop(printingId: string, face: "front" | "back"): Promise<Uint8Array | null>; // new
}>;
```

The renderer (an adapter already) decodes and encodes JPEGs with jpeg-js itself; the filters it
applies are the pure functions in `decks/domain/art-filters.ts` (section 14).

- **Catalog:** the image cache gains a fourth size, `artCrop`, cached on disk like the others.
  The Scryfall Zod schema keeps `art_crop`; until the next sync stores it, its URL is worked out
  from the `large` one (Scryfall uses the same path with `art_crop` in place of `large`).
- **Fonts:** the renderer embeds `mana.ttf` from the `mana-font` package (read from
  `node_modules`; the Docker image copies it), Helvetica for text.
- **Text measuring** is passed into the pure layout as a function (`(text, size, font) => width`),
  so the layout can be tested without pdf-lib.

## 7. State machines

None.

## 8. Persistence

No new tables or columns. `printings.image_uris` (jsonb) gains `artCrop` on the next sync.
`ProxyLine` gains what a playtest card needs (faces, colours, produced mana, set code, collector
number, artist), read by the existing deck query.

## 9. Read models (queries)

- The deck's print page: the new options and a one-card preview
  (`GET /decks/[id]/proxies.pdf?…options&preview=1`, shown in the browser rather than downloaded).

## 10. Events emitted

None.

## 11. Patterns applied

- **Functional core:** the card layout (boxes, word wrapping, font shrinking, which symbols go
  where) and the filters are pure functions in `decks/domain`; pdf-lib and jpeg-js only paint and
  decode.
- **Strategy:** the renderer draws each placement with a `scan` or `playtest` card drawer.
- **Ports & adapters:** JPEG decoding behind `ImageCodec`; text measuring injected.

## 12. Test plan

- Domain unit tests: word wrapping and font shrinking (with a fake measurer: every letter 1 unit
  wide), mana-cost parsing into symbols, stripe colours (mono, multi, colourless, lands, double-
  faced), split/adventure faces, invariant 2 (long text takes space from the art).
- Filter tests: grayscale of known colours; Sobel on a 5 × 5 image with one vertical edge gives a
  line exactly there; flat images give white; output size matches input.
- Renderer: a playtest PDF of a few fixture cards renders and has the right page count; a PNG
  snapshot of one card is kept for review (not compared pixel by pixel).
- Integration: the PDF downloads with `style=playtest` and each filter.
- Browser: choose Playtest, change the filter, the preview updates. Screenshots in dark mode and
  at phone width.
- **Every colour combination** (your request): a test deck with one card for each of the 32
  combinations (colourless, 5 mono, 10 pairs, 10 triples, 5 four-colour, five-colour), plus hybrid
  costs (`{W/U}`, `{2/G}`, `{C/R}`, `{G/U/P}`), Phyrexian, `{X}`, `{T}`/`{Q}` in text, a dual
  land, a five-colour land and an artifact. Unit tests check each card's stripe colours and
  symbols; the sheet is rendered with each filter and looked at page by page (converted to PNG)
  to check stripes stay light, every pair of colours is distinguishable, and symbols are crisp
  and the right size.
- Real-data checks: a long-text card (e.g. a planeswalker or saga), a split card, an adventure,
  a double-faced card, a five-colour card, a dual land, an artifact.

## 13. Decisions (2026-10-06)

1. **Default style:** **Scan** stays the default; Playtest is chosen in the form (and kept in
   the address).
2. **Image library:** **jpeg-js** plus our own filter functions.
3. **Edges threshold:** fixed, tuned once on real cards.
4. **Mana symbols:** the real artwork from the **Mana** font, at real-card sizes (section 3.4),
   not drawn letters.
5. **Testing:** every colour combination, hybrid and special symbol (section 12).
6. Stripes are not offered on the scan style (scans already show colour).

## 14. Implementation notes (2026-10-06)

- **Code:** symbols in `decks/domain/mana-symbols.ts`, filters in `decks/domain/art-filters.ts`,
  the card layout in `decks/domain/playtest-card.ts` (all pure), painting in
  `decks/infrastructure/playtest-painter.ts`. `ProxyLine` carries a `printed` card (faces,
  colours, produced mana, set, number, artist) from `printingCards`, which gained `setCode`,
  `layout`, `colors` and `producedMana`. No `ImageCodec` port: only the renderer needs JPEGs.
- **Stripe colours** come from the side's **mana costs first** (all faces on that side): MTGJSON
  stores only the first half's colour for split cards (Fire // Ice is listed as red), so the costs
  are the reliable source. A land that makes any colour (Command Tower) lists all five in
  `produced_mana`, so it prints **five-colour stripes**, not grey as section 3.3 first said.
  Stripes alternate each colour with a white gap, 5 pt wide; tints are in `STRIPE_TINTS`.
- **Symbols, as Mana's CSS draws them:** circle 1.3 × the glyph's em size, glyph centred by its
  bounding box (read with fontkit), cost symbols with the two-part drop shadow, text symbols
  without. Wide glyphs (`{100}`, `{1000000}`) are scaled down to fit their circle. Hybrids use
  Mana's lighter `--ms-mana-*` colours split at 135°, glyphs at 55% in the two halves.
- **Text sizes:** rules text 8.5 pt down to 5 pt (real cards are about 7.5 pt), then the art
  gives up space (none if under 30 pt tall), then down to 3.5 pt as a last resort. Names shrink
  from 9 pt, type lines from 7.5 pt.
- **Grey and edges art** are embedded as one-channel `DeviceGray` images (Flate), which printers
  print in black. Greyscale uses the PNG Paeth predictor (8.2 → 6.3 MB for the 43-card test
  sheet); edges don't (it made them bigger). Colour art is cropped and re-encoded as JPEG
  (quality 90). Edge threshold: strength 40 starts to show, 220 is solid black, after a 3 × 3
  blur.
- **Preview** is the same PDF route with `preview=1`: the first card the options print, one copy,
  shown in the browser (`Content-Disposition: inline`).
- **Checked on real data:** every colour combination, hybrids, Phyrexian, `{X}`, `{Q}`, `{S}`,
  `{E}`, `{½}`, `{∞}`, lands, split, adventure, double-faced, saga, planeswalker, vehicle and a
  long-text card, rendered and looked at page by page; and 18 real catalog printings with their
  Scryfall art crops (Fire // Ice, Reaper King, Atraxa, Delver, Esika's Chariot, …).
- **Sizes and speed:** a 43-card sheet takes about 2 s; per card about 90 KB in colour, 150 KB
  greyscale, 95 KB edges, 2.5 KB without art.

## 15. Bleed and guides, changed 2026-10-07 (your review)

- **Bleed fills the gap.** It used to add 1/8 inch (3 mm) round each card, which made 3 × 3 too
  big and cost three cards a page. Now the options are **None** and **Fill the gap**: each
  card's image (or a playtest card's stripes) reaches halfway into the gap around it, meeting its
  neighbour's, so the gap setting sets the bleed (2 mm gap → 1 mm each side). At the sheet's
  edges it goes into the margin, but never closer than 1/8 inch to the paper. The grid never
  changes. Old addresses with `bleed=eighthInch` fall back to no bleed.
- **Guides go on top, in mid grey.** Drawn underneath, the marks between cards were hidden by
  bleed. Now each card's corner marks start at its real 2.5 × 3.5 in corners and run outwards
  over its own bleed (half the gap; the same space when bleed is off), so they never cross a
  card; at the sheet's edges they continue 3 mm past the bleed into the margin. Full-line guides
  are drawn on top too.
- **Playtest bleed shows the stripes** rather than white, so an off cut shows stripes.
- **Deploy:** checked the production image (built as `scripts/deploy.sh` builds it) against the
  dev database: health, the worker, and playtest PDFs in every art filter from the production
  bundle.
