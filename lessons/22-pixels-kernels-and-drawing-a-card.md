# Lesson 22: Pixels, kernels, and drawing a card

- **Phase:** 22 (playtest proxies: low-ink cards drawn from their text)
- **Prerequisites:** [Lesson 01](01-architecture-foundation.md) (dependency injection),
  [Lesson 14](14-a-search-language-and-paper.md) (page layout in points, draw order)
- **Time:** 2 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Treat an image as a **typed array** of numbers, and say what **clamping** does that
   wrapping doesn't.
2. Turn colour into grey with **luma** weights, and crop to a shape the way `object-fit: cover`
   does.
3. Explain a **convolution kernel**, and find edges with the **Sobel filter** and a
   **threshold**.
4. Say why some images compress badly, and how a **predictor** helps.
5. Write a **layout as a pure function** by injecting how text is measured, then wrap words and
   shrink text until it fits.
6. **Clip** a polygon to a box, one half-plane at a time.
7. Use an **icon font**: glyphs at private code points, centred by their bounding box.
8. Report **progress** from slow work with a callback, and stream it to the browser as lines of
   JSON, without being caught out by half-lines or buffering.

---

# Part A: Images are arrays of numbers

## A1. Typed arrays, and what happens at 256

A photo is a grid of pixels; each pixel is red, green, blue and alpha (opacity), each 0–255. In
memory that's one long run of bytes, row by row from the top:

```
pixel (x, y) starts at index (y × width + x) × 4
[ r g b a | r g b a | r g b a | … ]
```

JavaScript's ordinary arrays hold any value, boxed one by one. A **typed array** is a fixed-size
block of one number type, like a numpy array with a `dtype`. Two byte-sized ones matter here:

| Type                | Store 300 | Store −5 | Store 2.5 | Arithmetic `200 + 100` stored back |
| ------------------- | --------- | -------- | --------- | ---------------------------------- |
| `Uint8Array`        | 44        | 251      | 2         | 44 (wraps around)                  |
| `Uint8ClampedArray` | 255       | 0        | 2         | 255 (clamped)                      |

**Clamping** means "anything too big becomes the maximum, anything too small the minimum".
For pixels that's what you want: brightening white should stay white, not wrap round to black.
That's why canvas image data, and this project's `Pixels`, use `Uint8ClampedArray`:

```ts
// src/modules/decks/domain/art-filters.ts
/** A colour image, four bytes per pixel (red, green, blue, alpha), row by row from the top. */
export type Pixels = Readonly<{ width: number; height: number; data: Uint8ClampedArray }>;
```

(Fractions are rounded to the nearest whole number, and exact halves to the even one: 2.5
becomes 2.)

**Python comparison:** a numpy `uint8` array **wraps** on arithmetic
(`np.array([200], dtype=np.uint8) + 100` is `[44]`), so image code in numpy usually works in a
wider type and calls `np.clip` before converting back. `Uint8ClampedArray` does the clip for you
on every store.

**Try it:** `node -e "const a = new Uint8ClampedArray(1); a[0] = 300; console.log(a[0])"`
prints 255; change `Uint8ClampedArray` to `Uint8Array` and it prints 44.

## A2. Grey, and cropping to a shape

Grey isn't the average of red, green and blue: eyes see green as much brighter than blue. The
standard weights (ITU-R BT.601 **luma**) are 0.299, 0.587 and 0.114:

```ts
// src/modules/decks/domain/art-filters.ts
export function grayscale(image: Pixels): GrayPixels {
  const data = new Uint8ClampedArray(image.width * image.height);
  for (let index = 0; index < data.length; index++) {
    const red = image.data[index * 4] ?? 0;
    const green = image.data[index * 4 + 1] ?? 0;
    const blue = image.data[index * 4 + 2] ?? 0;
    data[index] = 0.299 * red + 0.587 * green + 0.114 * blue;
  }
  return { width: image.width, height: image.height, data };
}
```

A grey image needs one byte per pixel, so `GrayPixels` has a quarter of the bytes. The `?? 0`
is there because indexing a typed array could, as far as TypeScript knows, run off the end
(lesson 06 covers `??`).

**Python comparison:** Pillow's `image.convert("L")` uses exactly these weights.

The art box on a card has its own shape, and the art crop from Scryfall a slightly different
one. `cropToAspect` keeps the middle and cuts the rest equally from both sides, which is what
CSS's `object-fit: cover` does for an `<img>`: fill the box, never squash. It copies whole rows
with `data.set(source.subarray(from, to), offset)`, the typed-array way to copy a slice without
a loop (like assigning a numpy slice).

---

# Part B: Kernels and edges

## B1. A kernel is a weighted look at the neighbours

Many image filters replace each pixel with a **weighted sum of the pixels around it**. The
weights, written as a small grid, are the **kernel**; sliding it over every pixel is a
**convolution**. A blur averages the 3 × 3 square:

```
1/9 × [ 1 1 1
        1 1 1
        1 1 1 ]
```

Pixels at the border have neighbours off the image. The project's `at()` takes the nearest
edge pixel instead (clamping the coordinates), so the border isn't darkened by imaginary black.

## B2. Sobel: how fast is brightness changing?

To find an edge, ask how much brighter the right side of a pixel is than its left side:

```
across:  [ -1  0  1        down:  [ -1 -2 -1
           -2  0  2                  0  0  0
           -1  0  1 ]                1  2  1 ]
```

On a flat area the left and right cancel and the result is 0. Across a dark-to-light boundary,
it's large. `down` is the same question turned 90°. Together they are a direction of change,
and its length, √(across² + down²), is the **edge strength**:

```ts
// src/modules/decks/domain/art-filters.ts
// [-1 0 1; -2 0 2; -1 0 1] and its transpose.
const across = topRight + 2 * right + bottomRight - (topLeft + 2 * left + bottomLeft);
const down = bottomLeft + 2 * bottom + bottomRight - (topLeft + 2 * top + topRight);
const strength = Math.hypot(across, down);
const darkness = (strength - EDGE_THRESHOLD) / (EDGE_FULL - EDGE_THRESHOLD);
data[y * gray.width + x] = 255 - 255 * Math.min(1, Math.max(0, darkness));
```

`Math.hypot(a, b)` is √(a² + b²) (Python: `math.hypot`). The last two lines turn strength into
ink:

- below `EDGE_THRESHOLD` (40) it's white: paper texture, soft shading and JPEG speckle;
- above `EDGE_FULL` (220) it's solid black;
- in between, a grey that grows with the strength.

A **threshold** like this is a judgement call. Design doc 22 fixed it after trying it on real
art: low enough to keep outlines, high enough that skies stay white. The image is blurred first,
because a JPEG's tiny blocks are themselves "edges" to Sobel.

The tests build images from rows of numbers, so the right answer is obvious by eye: a flat
image gives all white, and a black half next to a white half gives a black line at the boundary.

**Python comparison:** `scipy.ndimage.sobel` or OpenCV's `cv2.Sobel` do this; writing it by hand
shows it's just two weighted sums per pixel.

## B3. Why the grey PDF was bigger than the colour one

The first greyscale PDF was 8 MB against 3.7 MB for colour, though grey has a third of the
data. Colour art went in as a **JPEG**, which throws away detail eyes don't notice. Grey went in
as exact bytes compressed with **Flate** (zip). Zip finds repeated runs, and a photo has
almost none: neighbouring pixels are similar, not equal.

A **predictor** fixes that: store each pixel as the difference from a guess made from its
neighbours. Similar neighbours make small differences (mostly near 0), and those repeat and
compress well. PDF accepts PNG's predictors; the project uses Paeth (`paethRows` in
`playtest-painter.ts`), which guesses from the pixels left, above and above-left. Greyscale
dropped to 6.3 MB. Edges went the other way: mostly-white images already compress well, and the
differences made them bigger. So it's used for greyscale only. **Measure before keeping an
optimization.**

Grey images are written as `DeviceGray` (one channel), which printers print with black ink.

---

# Part C: Drawing a card is a pure function

## C1. Inject how text is measured

Where the text wraps depends on how wide each word is, and only the PDF library knows its
fonts. If the layout called pdf-lib directly, every test would need a real PDF. Instead the
layout takes the measuring as a parameter, which is **dependency injection** (lesson 01) for a
single function:

```ts
// src/modules/decks/domain/playtest-card.ts
/** How wide `text` is in this font and size (the renderer passes its font's measurer). */
export type Measure = (text: string, font: FontStyle, size: number) => number;
```

The renderer passes `font.widthOfTextAtSize`. The tests pass a stand-in where every character is
half as wide as the text is tall, so "Flying" at 8 pt is exactly 24 points:

```ts
// src/modules/decks/domain/playtest-card.test.ts
const measure: Measure = (text, _font, size) => text.length * size * 0.5;
```

`playtestCard` returns a plain object (`PlaytestDrawing`: stripes, panels, the art box, every
word and symbol with its position), and the renderer only paints it. That's the same split as
phase 14's sheet layout, one level down.

## C2. Wrap greedily, then shrink until it fits

**Greedy word wrap:** put words on the line while they fit, and start a new line when the next
one doesn't. Here a "word" can be several pieces with no space between, so `{T}:` (a symbol and
a colon) never splits across lines.

The text box has a fixed height. So `fittingFlow` tries sizes from the largest down, a quarter
point at a time, and keeps the first that fits:

```ts
for (let size = from; size >= to - 1e-9; size -= TEXT_SIZES.step) {
  const flowed = flow(paragraphs, width, size, measure);
  if (flowed.height <= height) return flowed;
}
return null;
```

The `- 1e-9` allows for floating point: subtracting 0.25 repeatedly from 8.5 lands on exactly
5 (quarters are exact in binary), but steps like 0.1 don't, and the loop would skip the last size.

When even 5 pt is too tall, the card follows design doc 22's invariant 2: **never cut rules
text**. The art box gives up the missing height, or disappears if what's left is too small to
be worth printing. Invariants like this one become tests: a wall of text produces a smaller art
box, and no word is drawn below the text box.

---

# Part D: Shapes and fonts

## D1. Clipping, one half-plane at a time

The stripes are diagonal bands that must stop at the card's edge (invariant 1). A band is "the
points where x − y lies between two values", which is two **half-planes** (everything on one
side of a line). Clipping a convex polygon to a half-plane (the **Sutherland–Hodgman**
algorithm) walks round its edges:

- a corner on the inside is kept;
- an edge that crosses the line adds the crossing point.

```ts
// src/modules/decks/domain/playtest-card.ts
if (currentSide >= 0 !== previousSide >= 0) {
  // The edge crosses the boundary: keep the crossing point.
  const t = previousSide / (previousSide - currentSide);
  kept.push({
    x: previous.x + t * (current.x - previous.x),
    y: previous.y + t * (current.y - previous.y),
  });
}
if (currentSide >= 0) kept.push(current);
```

`side(point)` is how far the point is from the line (positive inside), so `t` is how far along
the edge the sign changes. Start from the card's rectangle and clip twice, once per side of the
band, and what's left is exactly the stripe inside the card. A test checks every point of every
stripe is inside the card.

`polygon.at(index - 1)` reads from the end when the index is −1, like Python's `polygon[-1]`.
That's how the first corner finds its "previous" one.

## D2. An icon font, read from its stylesheet

The **Mana** font draws mana symbols as letters: `{W}` is the character ``. Code points
from U+E000 to U+F8FF are Unicode's **Private Use Area**, which means no standard character, so
fonts can put icons there. The font's stylesheet (`mana-font/css/mana.css`) is its real
specification:

```css
.ms-w::before {
  content: "\e600";
}
.ms-cost {
  background-color: #beb9b2;
  border-radius: 1em;
  width: 1.3em;
  height: 1.3em;
}
.ms-cost.ms-w {
  background-color: #f0f2c0;
}
.ms-cost.ms-shadow {
  box-shadow:
    -0.06em 0.07em 0 #111,
    0 0.06em 0 #111;
}
```

The painter reads that recipe as data: a circle 1.3 times the glyph size, the colour per mana,
the glyph on top, and a shadow offset in ems. `em` is a length relative to the font size, so the
same recipe works at any size. CSS's y axis points down and PDF's up, so the shadow's `0.07em`
down becomes `y - 0.07 * em`.

Centring needs to know where a glyph's ink is, which pdf-lib doesn't tell you. `fontkit` reads
the glyph's **bounding box** (the smallest rectangle around its ink) from the font file, in font
units:

```ts
const outline = manaOutlines.glyphForCodePoint(character.codePointAt(0) ?? 0);
const { minX, maxX, minY, maxY } = outline.bbox;
// Put the middle of the ink, not the glyph's origin, at (x, y).
x: x - ((minX + maxX) / 2) * scale,
```

`embedFont(bytes, { subset: true })` copies only the glyphs used into the PDF (**subsetting**):
a few kilobytes instead of the 400 KB font.

A test turns Scryfall's full symbol list (a recorded fixture) into glyphs and asks the real
font for each one. If Scryfall adds a symbol, a test fails, rather than a card printing a blank.

---

# Part E: Showing progress

## E1. A callback, then a stream of lines

A big deck takes a while: every image is fetched (from Scryfall the first time), then every page
drawn. With a plain link, the browser shows nothing until the file arrives. To show a bar, the
slow code has to **say how far it's got**, and the browser has to hear it while it's working.

Saying it is a **callback**: the use case takes an optional function and calls it after each
step. It doesn't know or care what the caller does with it:

```ts
// src/modules/decks/application/proxy-sheets.ts
onProgress: (progress: ProxyProgress) => void = () => undefined,
// …after each image:
done++;
onProgress({ stage: "images", done, total: wanted.size });
```

The default, a function that does nothing, means every other caller (and every older test) is
unchanged. Python would use the same idea: a `progress=None` parameter, or tqdm's `update()`.

Hearing it in the browser needs a response that arrives **in pieces**. The route answers with a
`ReadableStream` (lesson 17) of **JSON lines**: one small JSON object per line, flushed as each
step finishes, with the PDF (as base64 text) as the last line. On the page, `fetch` reads the
body chunk by chunk.

## E2. Chunks aren't lines

The network delivers **chunks**, and a chunk boundary can fall anywhere, including the middle of
a line. Splitting each chunk on its own would hand `JSON.parse` half an object. So the leftover
end of each chunk is kept and joined to the next:

```ts
// src/modules/decks/domain/proxy-progress.ts
export function completeLines(pending: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (pending + chunk).split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line !== ""), rest };
}
```

The last part after the final `\n` is never complete (it's empty if the chunk ended exactly on a
newline), so it becomes `rest`. **Python comparison:** the same care as reading a socket with
`recv()`, which also returns arbitrary pieces; `asyncio.StreamReader.readline()` does this
buffering for you.

One more trap is something in between holding the pieces back. Compression waits until it has
enough to squeeze, and a reverse proxy like nginx may collect the whole answer before passing
it on. The response says `Cache-Control: no-transform` (don't compress or change this) and
`X-Accel-Buffering: no` (nginx: pass it straight through), the same as the draft page's live
updates.

---

## Common mistakes

- **Wrapping where you meant to clamp.** `Uint8Array` and numpy's `uint8` wrap: 255 + 1 is 0.
  For pixels, use `Uint8ClampedArray`, or clip before storing.
- **Indexing pixels as (x, y) in the wrong order.** Rows come first in memory:
  `(y × width + x) × channels`. Swapping them works on square test images and fails on real ones,
  so test with a non-square image.
- **Thresholding without smoothing.** Edge detectors amplify noise; blur first, then threshold.
- **Measuring with one font and drawing with another.** The layout must measure exactly the
  string the renderer draws, characters swapped by `drawable()` included, or text overflows.
- **Comparing floating-point loop counters exactly.** Allow a tiny tolerance (`- 1e-9`), or count
  whole steps and multiply.
- **Copying a stylesheet's numbers but not its coordinate system.** CSS y grows downwards, PDF y
  upwards; ems are relative to the font size.
- **Keeping an optimization without measuring it.** The predictor shrank one kind of image and
  grew the other.
- **Treating a network chunk as a line.** Keep the unfinished end and join it to the next chunk.

## Exercises

### 1. Warm-up: invert

Write `invert(image: GrayPixels): GrayPixels`, which makes black white and white black.

<details><summary>Hint</summary>Each level becomes 255 minus itself.</details>

<details><summary>Solution</summary>

```ts
function invert(image: GrayPixels): GrayPixels {
  const data = new Uint8ClampedArray(image.data.length);
  for (let index = 0; index < data.length; index++) data[index] = 255 - (image.data[index] ?? 0);
  return { width: image.width, height: image.height, data };
}
```

`[0, 100, 255]` becomes `[255, 155, 0]`.

</details>

### 2. Brighter, without wrapping

Write `brighten(image, amount)` so that `[10, 200, 250]` brightened by 50 is
`[60, 250, 255]`, and darkening `[10, 200]` by 50 gives `[0, 150]`. Then predict what
`new Uint8Array([200]).map((level) => level + 100)` holds.

<details><summary>Hint</summary>A typed array's <code>map</code> returns the same kind of typed array.</details>

<details><summary>Solution</summary>

```ts
function brighten(image: GrayPixels, amount: number): GrayPixels {
  return {
    width: image.width,
    height: image.height,
    data: image.data.map((level) => level + amount),
  };
}
```

`map` on a `Uint8ClampedArray` stores into a new `Uint8ClampedArray`, so 300 becomes 255 and −40
becomes 0 with no extra code. On a `Uint8Array` the same `map` gives `[44]`: 300 wrapped round.

</details>

### 3. Half a Sobel

Write `acrossOnly(image: GrayPixels): number[]`, the `across` kernel alone (no threshold), with
coordinates clamped at the borders. Check that it finds the boundary in a 4 × 3 image whose
left half is 0 and right half 255, and gives all zeros when the boundary is horizontal instead.

<details><summary>Hint</summary>Copy <code>at()</code>'s clamping; the result for the middle row is <code>[0, 1020, 1020, 0]</code>.</details>

<details><summary>Solution</summary>

```ts
function acrossOnly(image: GrayPixels): number[] {
  const at = (x: number, y: number) =>
    image.data[
      Math.min(image.height - 1, Math.max(0, y)) * image.width +
        Math.min(image.width - 1, Math.max(0, x))
    ] ?? 0;
  const result: number[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      result.push(
        at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1)),
      );
    }
  }
  return result;
}
```

1020 is 4 × 255: the kernel's right column weighs 1 + 2 + 1. A horizontal boundary changes
nothing from left to right, which is why Sobel needs the `down` kernel too.

</details>

### 4. Greedy wrap

Write `wrap(words, width, measure, size): string[][]` returning the words on each line. With the
test measurer at size 2 (each letter 1 wide, a space 1 wide) and width 10,
`"Lightning Bolt deals 3 damage"` wraps as `[["Lightning"], ["Bolt", "deals"], ["3", "damage"]]`.

<details><summary>Hint</summary>Only add a space before a word that isn't first on its line.</details>

<details><summary>Solution</summary>

```ts
function wrap(words: readonly string[], width: number, measure: Measure, size: number): string[][] {
  const space = measure(" ", "regular", size);
  const lines: string[][] = [];
  let line: string[] = [];
  let x = 0;
  for (const word of words) {
    const wordWidth = measure(word, "regular", size);
    if (line.length > 0 && x + space + wordWidth > width) {
      lines.push(line);
      line = [];
      x = 0;
    }
    x += (line.length > 0 ? space : 0) + wordWidth;
    line.push(word);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}
```

A word wider than the whole line still gets a line of its own (`line.length > 0` is false for
the first word), so the loop can't get stuck.

</details>

### 5. Challenge: shrink with a binary search

`fittingFlow` tries up to 15 sizes one by one. Since smaller text always fits if larger text
does, a **binary search** needs about four tries. Write
`largestFitting(fits, largest, smallest, step): number | null` that returns the largest size on
the step grid for which `fits(size)` is true, or null if even `smallest` doesn't fit. With
`fits = (size) => size <= 6.6`, from 9 to 5 in quarters, the answer is 6.5.

<details><summary>Hint</summary>Search over step indexes (0 = largest), not over sizes, so every value is exactly on the grid.</details>

<details><summary>Solution</summary>

```ts
function largestFitting(
  fits: (size: number) => boolean,
  largest: number,
  smallest: number,
  step: number,
): number | null {
  let low = 0;
  let high = Math.round((largest - smallest) / step);
  const sizeAt = (index: number) => largest - index * step;
  if (!fits(sizeAt(high))) return null;
  // sizeAt(high) always fits; find the smallest index (largest size) that does.
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(sizeAt(middle))) high = middle;
    else low = middle + 1;
  }
  return sizeAt(high);
}
```

It only works because "fits" is **monotonic** (once a size fits, every smaller one does). The
project keeps the simple loop: laying out a card takes microseconds, and the loop is easier to
read. Same answer, different trade-off.

</details>

### 6. Events from chunks

Write `eventsFrom(chunks: readonly string[]): unknown[]` that parses every JSON line across the
chunks, using `completeLines`. Check it on `['{"done":1}\n{"do', 'ne":2}\n', '{"done":3}\n']`,
which should give three objects. What goes wrong if you split each chunk on its own instead?

<details><summary>Hint</summary>Carry <code>rest</code> from one call to the next.</details>

<details><summary>Solution</summary>

```ts
function eventsFrom(chunks: readonly string[]): unknown[] {
  const events: unknown[] = [];
  let pending = "";
  for (const chunk of chunks) {
    const { lines, rest } = completeLines(pending, chunk);
    pending = rest;
    for (const line of lines) events.push(JSON.parse(line));
  }
  return events;
}
```

Split on their own, the first chunk gives `{"do` and the second `ne":2}`, and `JSON.parse`
throws on both halves.

</details>

## Recap

- An image is a typed array; `Uint8ClampedArray` clamps where `Uint8Array` and numpy wrap.
- Grey is a weighted sum (luma), not an average; cropping like `object-fit: cover` keeps the
  middle.
- A kernel is a weighted sum of neighbours. Sobel's two kernels measure change across and down,
  and a threshold decides what counts as an edge. Blur first.
- Photos compress badly as exact bytes; predictors turn them into small differences. Measure the
  result.
- Inject measurement and the whole card layout is a pure, testable function; wrap greedily and
  shrink until it fits, and never cut text.
- Clip to a half-plane twice and a band becomes a stripe that stays inside the card.
- Icon fonts keep glyphs in the Private Use Area; their stylesheet is the spec, and a fixture
  test keeps the symbol table complete.
- Slow work reports progress through an optional callback; a stream of JSON lines carries it to
  the browser, which must join chunks into whole lines, and nothing in between may buffer it.

## Further reading

- [Design doc 22](../docs/design/22-playtest-proxies.md): the decisions and measurements.
- [Mana](https://github.com/andrewgioia/mana): the font and its stylesheet.
- [Sobel operator](https://en.wikipedia.org/wiki/Sobel_operator) and
  [Sutherland–Hodgman](https://en.wikipedia.org/wiki/Sutherland%E2%80%93Hodgman_algorithm) on
  Wikipedia.
- PNG's [filter types](https://www.w3.org/TR/png/#9Filter-types), which PDF reuses as predictors.
