# Lesson 13: Reading someone else's website

- **Phase:** 13 (official product photos, key art, MSRPs and details from Wizards Play Network)
- **Prerequisites:** [Lesson 04](04-pulling-in-outside-data.md) (anti-corruption layers,
  fixtures), [Lesson 07](07-reading-data-and-keeping-books.md) (SQL from parts, `??`)
- **Time:** 2–3 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Choose a data source by **permission** as well as convenience, and tell a public page from a
   private key.
2. Read data a website **embeds in its page**, including the "flattened" format that uses
   references, and write the function that rebuilds it.
3. Treat another site's content as **untrusted**: validate it, **allow-list** image addresses, and
   turn HTML into plain text instead of showing it.
4. **Match names** between two systems with a normalization pipeline, and tune it on real data by
   measuring what it gets wrong.
5. Write a step that is **fail-safe**: one broken page never breaks the job, and the screen falls
   back to something sensible.
6. Express a **precedence** rule ("override, else official, else default") in TypeScript and SQL,
   and keep the two in step.

---

# Part A: Where the pictures come from

## A1. Permission first

The store showed made-up packaging because nobody had chosen a source of product photos. Shops
like Amazon have photos, but they aren't ours to use. Two questions come before any code:

1. **Is it allowed?** Wizards' **Fan Content Policy** (the rules for free, unofficial projects)
   allows using Wizards' "pictures, artwork, graphics", even behind a login for a private group,
   as long as it stays free and shows a notice. It forbids using Magic's logos and trademarks on
   their own, so a set logo cut out of an image is out, but a product photo with the logo printed
   on its box is fine, shown whole.
2. **Who publishes it officially?** Wizards Play Network (WPN), Wizards' site for game stores,
   has a public page per set with a photo of every product.

That's why the site now has a footer with the policy's notice, and why photos are never cropped.

## A2. A public page is not a public API

WPN's pages are built from Wizards' content service, and each page carries an **access token**
for it (a password-like string that lets Wizards' own site ask the service for data). With that
token we could query the service directly and skip reading pages. We don't: the token was given
to Wizards' site, not to us. Using it would be like reading a shop's stock database because its
password was taped to the till. What's offered to everyone is the page, so we read the page, as
a browser does, one page a second.

**Python comparison:** the difference between `requests.get(page_url)` and copying an
`Authorization` header out of your browser's developer tools into a script. The second might
work, but it isn't yours to use.

---

# Part B: Getting data out of a page

## B1. Data the page carries with it

Reading HTML (`<div class="_name_1wayc_82">Play Booster</div>`) is fragile: those class names are
generated and change with every redesign. But WPN is built with **Nuxt**, a framework that sends
the page's data along with it, as JSON in a script tag, so the browser doesn't have to ask again:

```html
<script type="application/json" id="__NUXT_DATA__">
  [{"state":1}, …]
</script>
```

That data holds a clean record per product (name, images, MSRP, contents, release date), which
changes far less often than the layout. So [`wpn.ts`](../src/modules/catalog/infrastructure/wpn.ts)
finds the tag with a regular expression and parses what's inside.

## B2. Flattened data: references instead of copies

The JSON inside isn't the data itself. It's **flattened** (the `devalue` library's format): one
array where index 0 is the root, and every number inside an object or array points to another
slot.

```json
[{ "product": 1 }, { "name": 2, "price": 3 }, "Play Booster", "$5.49"]
```

means:

```json
{ "product": { "name": "Play Booster", "price": "$5.49" } }
```

Why do this? Two places that hold the same object store it once. The format can even represent a
**cycle** (an object that eventually refers back to itself), which plain JSON can't.

Rebuilding it is a small recursive function. The idea in Python first:

```python
def unflatten(flat):
    done = {}
    def value(i):
        if i in done:
            return done[i]
        raw = flat[i]
        if isinstance(raw, dict):
            obj = {}
            done[i] = obj            # remember it BEFORE filling it in
            for key, ref in raw.items():
                obj[key] = value(ref)
            return obj
        done[i] = raw
        return raw
    return value(0)
```

The line to notice is `done[i] = obj` **before** the loop. If slot 5 eventually refers back to
slot 5, the second visit finds the half-built object in `done` and stops, instead of recursing
forever. It's the same trick as Python's `copy.deepcopy`, which keeps a `memo` dictionary for the
same reason.

The TypeScript version, `unflatten` in `wpn.ts`, adds two details from the real format: a
two-element array that starts with a string, like `["Ref", 5]`, is a **tagged value** (Nuxt's
way of saying "this was a reactive reference to slot 5"); we keep what it wraps. And negative
numbers stand for `undefined` and similar values.

**Try it:** in `pnpm exec tsx`, paste the Python idea as TypeScript and call it on the
four-element example above.

## B3. Finding what you need, not a path to it

Where do the product records sit in that rebuilt tree? Somewhere deep, and the path could change.
So instead of `root.data[3].fields.products[…]`, the code **walks the whole tree** and keeps any
object with the fields a product has:

```ts
if (fields && typeof fields.name === "string" && "packageContents" in fields) { … }
```

It walks with a **queue** (first in, first out: `for (let next = 0; next < queue.length; next++)`),
which visits things in roughly the order the data lists them. An earlier version used a stack
(`pop()`), which visits the last-added first: every product came out backwards.

## B4. Untrusted input: validate, allow-list, flatten to text

Everything from another site is **untrusted input**: it can change shape, and it could contain
things we'd rather not show. Three defenses:

1. **Validate, but leniently.** `ProductRecord.safeParse(record)` (Zod, lesson 04) keeps only the
   fields we use. `safeParse` returns a result instead of throwing, so one odd product is skipped
   and the others still load.
2. **Allow-list** image addresses. An allow-list says what's accepted; everything else is refused.
   (A deny-list tries to name what's forbidden, and always misses something.)

   ```ts
   const IMAGE_URL =
     /^\/\/images\.ctfassets\.net\/0piqveu8x9oj\/([A-Za-z0-9]+)\/([a-f0-9]+)\/[^/?#"]+\.(?:png|jpe?g|webp)$/;
   ```

   `^` and `$` anchor the pattern to the whole string, so `…/../../x.png` or an Amazon address
   can't slip through by containing an allowed part.

3. **Never show their HTML.** Descriptions arrive as HTML, some with their own `<style>` blocks.
   Rendering it would let another site's markup into our pages. `plainText` and `contentsLines`
   turn it into text (lines, with depth for nested lists), and React shows text safely: it escapes
   `<` and `>` for us.

**Python comparison:** `bleach.clean(html, tags=[], strip=True)` gives plain text; the allow-list
regex is the same idea as `re.fullmatch`.

---

# Part C: Matching two systems' names

## C1. A normalization pipeline

WPN calls a product "Magic: The Gathering®—FINAL FANTASY™ Scene Box – Camp Comrades". MTGJSON
calls it "Final Fantasy Scene Box Camp Comrades". To compare them, both go through the same
**normalization**: steps that remove differences that don't matter.

From [`wpn.ts`](../src/modules/catalog/domain/wpn.ts), `normalizeName`:

1. drop `™` and `®`;
2. split accented letters into letter + accent (`normalize("NFKD")`) and drop the accents;
3. lowercase, drop apostrophes, and turn every other run of punctuation into a space;
4. make each word singular ("decks" → "deck", "boxes" → "box");
5. remove "magic the gathering" and the set's own name.

**Order matters.** Step 1 used to come after step 2, and `NFKD` doesn't just split accents: it
also rewrites "™" as the two letters "TM". So "FINAL FANTASY™" became `final-fantasytm`, and the
set's page address was wrong. A test with a real name caught it.

**Python comparison:** `unicodedata.normalize("NFKD", s)` does exactly the same, `™` included.

## C2. Words, not substrings

"Commander Decks Collector's Edition" should match "Commander Deck Wakanda Forever Collector's
Edition". As normalized strings, the first isn't a substring of the second: "wakanda forever" sits
in the middle. So names are compared as **sets of words**: every WPN word must appear in our name,
in any order.

That's too loose on its own: "nightmare bundle" is inside "nightmare bundle booster", a booster
pack sold inside the bundle. The fix is a second condition: our name may not add a
**product-type word** ("booster", "pack", "box", "case", …) that the WPN name doesn't have.

```ts
[...wpnWords].every((word) => productWords.includes(word)) &&
  productWords.every((word) => wpnWords.has(word) || !PRODUCT_TYPE_WORDS.has(word));
```

## C3. Tune on real data, and measure

Unit tests prove the rules do what we meant. They can't tell us whether we meant the right
things. So before building the screens, a one-off script ran the matcher on **all 19 real WPN
pages against our real products** and printed every match. It found four mistakes no test had
imagined:

| Found                                                                                         | Rule added                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| "Scene Boxes" matched the _Scene Box Case_                                                    | products named "case" or "set of" never match  |
| "Bundle" claimed the _Pizza Bundle_ before WPN's own "Pizza Bundle" could                     | specific names match first                     |
| each "Collector Booster" also matched its _Minimal Packaging_ version, so neither got a photo | the one that's **plainly** the product gets it |
| Collector's Edition decks got the regular decks' price                                        | words in any order (C2)                        |

The two ways a matcher goes wrong have names: **precision** (of the matches it makes, how many
are right: the Scene Box Case was a precision mistake) and **recall** (of the matches it should
make, how many it finds: the missing Collector Booster photos were a recall mistake). Here a
wrong photo is worse than no photo, so when unsure the matcher links a product for its price and
details but **keeps the generated art**: favor precision.

---

# Part D: Failing safely, and choosing a price

## D1. A step that can't break the job

The sync (lesson 04) imports sets and prices. Reading WPN is a new step at the end, and its rule
is: **nothing here fails the sync**. Each set is tried on its own:

```ts
try {
  // read the page, match, save
} catch (error) {
  await artwork.savePageProblem(state.code, "unreadable", message, now);
  summary.unreadable.push({ code: state.code, error: message });
}
```

A missing page is recorded as `no_page`, a changed one as `unreadable`, and every image that won't
download is simply tried again next time. The screen does the other half: `ProductImage` shows the
photo if the sync downloaded one, and the generated art otherwise. So the worst case, WPN
redesigning its whole site, is "the store looks like it did last month", plus a list on Admin →
Photos of what lost its picture.

**Python comparison:** the per-item `try`/`except` in a loop that logs and `continue`s, instead of
letting one bad row stop a batch job.

## D2. Precedence: override, else official, else default

A product's price is the first of three that exists: an admin's own price, Wizards' official
MSRP, and its kind's price. In TypeScript, `??` ("if the left side is `null` or `undefined`, use
the right") chains naturally:

```ts
return prices.override ?? prices.officialMsrp ?? prices.kindPrice;
```

SQL has the same idea: `coalesce(o.cents, w.msrp_cents, k.cents)` returns its first non-null
argument. Both exist because the store _lists_ prices in SQL (thousands of products at once) and
_charges_ them in TypeScript (one product, inside the purchase transaction).

**Python comparison:** careful with `or`. `override or official or default` also skips `0`,
`""` and `[]`, not just `None`. `??` only skips `null`/`undefined`, like
`next(p for p in (a, b, c) if p is not None)`.

## D3. Two copies of one rule

While testing, a real bug appeared: the "Marvel Super Heroes Collector Booster Box **Master
Case**" holds 24 boxes, but MTGJSON files it as a `booster_box`, so it sold at one box's price.
The fix, "a case never takes its kind's price", has to exist in both places from D2:

```ts
export function kindPriceApplies(productName: string): boolean {
  return !/\bcase\b/i.test(productName);
}
```

```sql
left join msrp_prices k on k.kind = … and not sp.name ~* '\mcase\M'
```

`\b` (JavaScript) and `\m`/`\M` (Postgres) both mean a **word boundary**, so "Showcase" doesn't
count. When one rule must live in two languages, say so in both places (each comment names the
other) and test both: a unit test for the function, an integration test that buys at the listed
price.

## D4. Same item, same picture

A Play Booster has three pack arts. Each unopened pack should show one, and the **same one** every
time you look. Randomness would change it on every page load, so the choice comes from something
stable, the item's id:

```ts
export function variantFor(itemId: number, variantCount: number): number {
  return ((itemId % variantCount) + variantCount) % variantCount;
}
```

Why not just `itemId % variantCount`? In JavaScript, `%` keeps the sign of the left side:
`-7 % 3` is `-1`, not an index. Python's `%` gives `2`. The `+ variantCount` then `% variantCount`
makes it Python-like for any integer.

---

## Common mistakes

- **Reading layout instead of data.** Generated class names and page structure change with every
  redesign; embedded data changes far less. Prefer the data, and keep the HTML parts tiny.
- **Using credentials you found.** A token embedded in a page is someone else's key. Read what's
  offered publicly.
- **Trusting another site's content.** Validate it, allow-list addresses with anchored patterns,
  and show text, never their HTML.
- **Normalizing in the wrong order.** Unicode normalization rewrites more than accents. Test the
  pipeline with real, awkward names (™, ’, –).
- **Tuning a matcher only on tests.** Tests prove your rules; real data proves they're the right
  rules. Run the matcher on everything once and read the output.
- **Letting an optional step fail the whole job.** Catch per item, record the problem, fall back.
- **`||` for defaults when 0 or "" are valid.** Use `??` (and in Python, `is None`).
- **A rule in two languages with only one test.** Test each copy, or they drift apart.

## Exercises

### 1. Predict the address (warm-up)

What does `slugCandidates("Duskmourn: House of Horror")` return? And
`slugCandidates("Marvel's Spider-Man")[0]`?

<details><summary>Solution</summary>

```ts
["duskmourn-house-of-horror", "magic-the-gathering-duskmourn-house-of-horror"];
("marvels-spider-man");
```

The colon and spaces become one hyphen each run; the apostrophe is dropped before that step, so
"Marvel's" becomes "marvels", not "marvel-s".

</details>

### 2. Rebuild flattened data

Write `unflatten(flat: unknown[]): unknown` for the format in B2 (objects and arrays of indexes;
anything else is a plain value; ignore tagged values and negative numbers). It must handle a
cycle. Check it with:

```ts
unflatten([{ product: 1 }, { name: 2, price: 3 }, "Play Booster", "$5.49"]);
// { product: { name: "Play Booster", price: "$5.49" } }
const loop = unflatten([{ self: 0 }]) as { self: unknown };
loop.self === loop; // true
```

Hint: remember each object before filling it in.

<details><summary>Solution</summary>

```ts
function unflatten(flat: unknown[]): unknown {
  const done = new Map<number, unknown>();
  function value(index: number): unknown {
    if (done.has(index)) return done.get(index);
    const raw = flat[index];
    if (raw === null || typeof raw !== "object") {
      done.set(index, raw);
      return raw;
    }
    if (Array.isArray(raw)) {
      const list: unknown[] = [];
      done.set(index, list);
      for (const item of raw) list.push(value(item as number));
      return list;
    }
    const object: Record<string, unknown> = {};
    done.set(index, object);
    for (const [key, item] of Object.entries(raw)) object[key] = value(item as number);
    return object;
  }
  return value(0);
}
```

</details>

### 3. The ™ bug

This version turns "FINAL FANTASY™" into `final-fantasytm`. Fix it without changing what it does
to other names:

```ts
const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[™®]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
```

<details><summary>Solution</summary>

Move the trademark step before `normalize`, which rewrites "™" as "TM":

```ts
const slug = (name: string) =>
  name
    .replace(/[™®]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
// slug("FINAL FANTASY™") === "final-fantasy"; slug("Lórien") === "lorien"
```

</details>

### 4. Modulo that never goes negative

Without looking at `variantFor`, write `wrap(n: number, size: number): number` that returns an
index from `0` to `size - 1` for any integer `n`, so `wrap(-7, 3) === 2` (Python's `-7 % 3`) and
`wrap(7, 3) === 1`.

<details><summary>Solution</summary>

```ts
const wrap = (n: number, size: number) => ((n % size) + size) % size;
// wrap(-7, 3) === 2; wrap(7, 3) === 1; wrap(0, 3) === 0
```

`-7 % 3` is `-1`; adding 3 gives 2; the final `% 3` handles the positive case, where adding 3 went
past the end (7 % 3 = 1, + 3 = 4, % 3 = 1).

</details>

### 5. The price, in SQL

Given these rows, write one `select` that gives each product's price by the rule in D2, where a
case never takes its kind's price:

```sql
with products(name, own, official, kind_price) as (values
  ('Bundle', null::int, 5799, 5999),
  ('Play Booster Pack', 450, null, 549),
  ('Collector Booster Box Master Case', null, null, 26999),
  ('Jumpstart Pack', null, null, null))
```

Expected: 5799, 450, null, null.

<details><summary>Solution</summary>

```sql
select name,
       coalesce(own, official, case when name !~* '\mcase\M' then kind_price end) as price
  from products;
```

`case when … then … end` without an `else` gives `null`, which `coalesce` skips, so a case falls
through to "not for sale" when it has no own or official price.

</details>

### 6. Precision or recall? (discussion)

A product matched two WPN products equally well. Should the matcher pick one (and show its
photo), or show no photo? What changes if a wrong photo only cost a little?

<details><summary>Solution</summary>

Here a wrong photo misleads players (they'd see a different deck than they're buying), so the
matcher favors **precision**: no photo, generated art, and an admin can pick. If mistakes were
cheap and missing photos were costly (say, an internal tool), favoring **recall** (show the best
guess) would be reasonable. The choice depends on what each kind of mistake costs, which is a
product decision, not a technical one.

</details>

## Recap

- Choose sources by **permission**: official, public, and allowed by the owner's policy. A token
  found in a page isn't yours.
- Prefer a page's **embedded data** over its layout. Flattened data is rebuilt by following
  references, remembering each object before filling it (cycles).
- Treat outside content as **untrusted**: lenient validation, anchored **allow-lists**, plain text
  instead of HTML.
- Matching names is a **normalization pipeline** plus a comparison rule. Order the steps
  carefully, compare **words**, and **measure on real data** for precision and recall.
- Optional steps are **fail-safe**: catch per item, record, retry later, fall back on screen.
- **Precedence** is `??` in TypeScript and `coalesce` in SQL. A rule in two languages needs a
  test in each.

## Further reading

- [Design doc 13](../docs/design/13-product-images.md) and
  [ADR 0015](../docs/adr/0015-wpn-product-imagery.md)
- [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy)
- `devalue` (the flattened format): <https://github.com/Rich-Harris/devalue>
- MDN: [`String.prototype.normalize`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize),
  [remainder `%`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder)
