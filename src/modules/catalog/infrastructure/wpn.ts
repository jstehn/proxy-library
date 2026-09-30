// Wizards Play Network product pages (design doc 13, ADR 0015): the anti-corruption layer that
// turns a page into a WpnSetPage. Nothing outside this file sees WPN's HTML or data format.
//
// A WPN page is built with Nuxt, which embeds the page's data as JSON in a
// <script id="__NUXT_DATA__"> tag. That data holds one record per product (name, images, MSRP,
// contents, release date), which is far steadier to read than the page's HTML, whose class
// names are generated. Only the key art is read from the HTML: it's the header image.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { fetchBytes, HttpError, type Fetch } from "@/shared/http";
import type { ArtworkStore, WpnGateway } from "../application/ports";
import {
  parseMsrp,
  type ContentsLine,
  type WpnImage,
  type WpnProduct,
  type WpnSetPage,
} from "../domain/wpn";

const WPN_PAGES = "https://wpn.wizards.com/en/products";

/**
 * Only Wizards' own image host, in WPN's space, is accepted (design doc 13, rule 1). The asset id
 * and version in the path identify the image; together they make a safe file name.
 */
const IMAGE_URL =
  /^\/\/images\.ctfassets\.net\/0piqveu8x9oj\/([A-Za-z0-9]+)\/([a-f0-9]+)\/[^/?#"]+\.(?:png|jpe?g|webp)$/;

/** An image from its address, or null when it isn't on Wizards' image host. */
export function wpnImage(url: string): WpnImage | null {
  const match = IMAGE_URL.exec(url);
  if (match === null) return null;
  return { id: `${match[1]}-${match[2].slice(0, 12)}`, url };
}

// --- Nuxt's embedded data ----------------------------------------------------------------

/**
 * Nuxt stores its data "flattened" (the `devalue` library's format): one big JSON array where
 * index 0 is the root, and numbers inside objects and arrays point to other slots. So
 * `[{"name": 1}, "Play Booster"]` means `{ name: "Play Booster" }`. This undoes that. Special
 * values ("Ref", "Date", …) are two-element arrays starting with their tag; we keep what they
 * wrap. Negative numbers stand for undefined, NaN and similar.
 */
function unflatten(flat: unknown[]): unknown {
  const done = new Map<number, unknown>();

  function value(index: number): unknown {
    if (index < 0) return undefined;
    if (done.has(index)) return done.get(index);
    const raw = flat[index];
    if (raw === null || typeof raw !== "object") {
      done.set(index, raw);
      return raw;
    }
    if (Array.isArray(raw)) {
      if (typeof raw[0] === "string") {
        // A tagged value, e.g. ["Ref", 5] or ["Date", "2026-…"]: keep what it wraps.
        const wrapped = typeof raw[1] === "number" ? value(raw[1]) : raw[1];
        done.set(index, wrapped);
        return wrapped;
      }
      const list: unknown[] = [];
      done.set(index, list); // before filling it, so a cycle points here instead of looping
      for (const item of raw) list.push(typeof item === "number" ? value(item) : item);
      return list;
    }
    const object: Record<string, unknown> = {};
    done.set(index, object);
    for (const [key, item] of Object.entries(raw)) {
      object[key] = typeof item === "number" ? value(item) : item;
    }
    return object;
  }

  return value(0);
}

/** Every object anywhere in the data that has `fields.name` and `fields.packageContents`. */
function productRecords(root: unknown): unknown[] {
  const found = new Map<string, unknown>();
  const visited = new Set<unknown>();
  // A queue (first in, first out), so products come out in the page's own order.
  const queue: unknown[] = [root];
  for (let next = 0; next < queue.length; next++) {
    const node = queue[next];
    if (node === null || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    const fields = (node as { fields?: Record<string, unknown> }).fields;
    if (fields && typeof fields.name === "string" && "packageContents" in fields) {
      const key = typeof fields.entryTitle === "string" ? fields.entryTitle : fields.name;
      if (!found.has(key)) found.set(key, fields);
    }
    queue.push(...(Array.isArray(node) ? node : Object.values(node)));
  }
  return [...found.values()];
}

/** The fields we use from a product record; everything else is ignored. */
const ProductRecord = z.object({
  name: z.string().min(1),
  releaseDate: z.string().optional(),
  msrp: z.string().optional(),
  copy: z.string().optional(),
  packageContents: z.string().optional(),
  images: z
    .array(
      z.object({
        fields: z.object({ file: z.object({ url: z.string() }) }).optional(),
      }),
    )
    .optional(),
});

// --- WPN's HTML fragments, as plain text -------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  trade: "™",
  reg: "®",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Tidy text: entities decoded, runs of spaces collapsed. */
function cleanText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** Removes <style> and <script> blocks (some descriptions carry their own CSS). */
function withoutCode(html: string): string {
  return html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ");
}

/** A description's HTML as plain text paragraphs (never HTML: we don't show WPN's markup). */
export function plainText(html: string | undefined): string | null {
  if (html === undefined) return null;
  const text = withoutCode(html)
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const paragraphs = text
    .split("\n")
    .map(cleanText)
    .filter((line) => line !== "");
  return paragraphs.length === 0 ? null : paragraphs.join("\n");
}

/** A contents list (nested <ul>/<li>) as lines with their depth. */
export function contentsLines(html: string | undefined): ContentsLine[] {
  if (html === undefined) return [];
  const lines: ContentsLine[] = [];
  let depth = -1;
  let current = "";
  const flush = () => {
    const text = cleanText(current);
    if (text !== "") lines.push({ depth: Math.max(depth, 0), text });
    current = "";
  };
  for (const part of withoutCode(html).split(/(<[^>]+>)/)) {
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(part);
    if (tag === null) {
      current += part;
      continue;
    }
    const [, closing, name] = tag;
    const element = name.toLowerCase();
    if (element === "ul" || element === "ol") {
      flush();
      depth += closing ? -1 : 1;
    } else if (element === "li" || element === "p" || element === "br") {
      flush();
    } else {
      current += " "; // inline tags like <i> separate words at most
    }
  }
  flush();
  return lines;
}

// --- The page ----------------------------------------------------------------------------

/** Why a page couldn't be read. The sync records it and keeps the generated art. */
export class WpnPageUnreadable extends Error {}

/** Reads a WPN product page (design doc 13). Throws WpnPageUnreadable if its shape changed. */
export function parseWpnPage(html: string, slug: string): WpnSetPage {
  const script = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (script === null) throw new WpnPageUnreadable("the page has no embedded data");
  let root: unknown;
  try {
    root = unflatten(JSON.parse(script[1]) as unknown[]);
  } catch {
    throw new WpnPageUnreadable("the page's embedded data isn't readable");
  }

  const products: WpnProduct[] = [];
  for (const record of productRecords(root)) {
    const parsed = ProductRecord.safeParse(record);
    if (!parsed.success) continue; // one odd product shouldn't hide the others
    const fields = parsed.data;
    const images = (fields.images ?? [])
      .map((image) => (image.fields ? wpnImage(image.fields.file.url) : null))
      .filter((image): image is WpnImage => image !== null);
    products.push({
      name: cleanText(fields.name),
      releaseDate: /^\d{4}-\d{2}-\d{2}/.exec(fields.releaseDate ?? "")?.[0] ?? null,
      msrpCents: parseMsrp(fields.msrp),
      description: plainText(fields.copy),
      contents: contentsLines(fields.packageContents),
      images,
    });
  }
  if (products.length === 0) throw new WpnPageUnreadable("no products found on the page");

  // The key art: the first image in the page's header block.
  const hero =
    /data-hero-block-v[\s\S]*?(?:srcset|src)="(\/\/images\.ctfassets\.net\/[^"?\s]+)/.exec(html);
  return { slug, keyArt: hero ? wpnImage(hero[1]) : null, products };
}

// --- Gateways ----------------------------------------------------------------------------

/** A download URL for an image at a width, as WebP (Wizards' image host resizes on request). */
export function imageDownloadUrl(image: WpnImage, width: number): string {
  return `https:${image.url}?w=${width}&fm=webp&q=82`;
}

/**
 * WPN over HTTP. `pageFetch` should be slow and polite (one page a second); `imageFetch` may be
 * a little faster, since images come from a CDN.
 */
export function httpWpnGateway(pageFetch: Fetch, imageFetch: Fetch): WpnGateway {
  return {
    async setPage(slug) {
      const url = `${WPN_PAGES}/${slug}`;
      const response = await pageFetch(url);
      if (response.status === 404) return null;
      if (!response.ok) throw new HttpError(url, response.status);
      return parseWpnPage(await response.text(), slug);
    },
    async image(image, width) {
      return fetchBytes(imageFetch, imageDownloadUrl(image, width));
    },
  };
}

/**
 * A 4×4 purple WebP image, made by Chromium so browsers surely decode it: what the fixture
 * gateway "downloads" (tests never use the network).
 */
const TINY_WEBP = Buffer.from(
  "UklGRhoCAABXRUJQVlA4WAoAAAAgAAAAAwAAAwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggLAAAAJABAJ0BKgQABAABQCYloAJ0ugADmAD+7tPf/ucD/ucD/ucD+Ov8UApHAeAA",
  "base64",
);

/**
 * WPN from recorded pages in tests/fixtures/wpn/<slug>.html; a missing file is a 404.
 * `broken` pages come back redesigned (unreadable), to test that the sync survives it.
 */
export function fixtureWpnGateway(options: { broken?: string[] } = {}) {
  const pagesRead: string[] = [];
  const imagesDownloaded: string[] = [];
  const gateway: WpnGateway = {
    async setPage(slug) {
      pagesRead.push(slug);
      if (options.broken?.includes(slug)) return parseWpnPage("<html>Redesigned!</html>", slug);
      let html: string;
      try {
        html = readFileSync(`tests/fixtures/wpn/${slug}.html`, "utf8");
      } catch {
        return null;
      }
      return parseWpnPage(html, slug);
    },
    async image(image, width) {
      imagesDownloaded.push(`${image.id}@${width}`);
      return new Uint8Array(TINY_WEBP);
    },
  };
  return { ...gateway, pagesRead, imagesDownloaded };
}

/** Artwork kept in memory, for tests. */
export function memoryArtworkStore(): ArtworkStore & { readonly keys: string[] } {
  const files = new Map<string, Uint8Array>();
  return {
    async get(imageId, size) {
      return files.get(`${imageId}/${size}`) ?? null;
    },
    async put(imageId, size, bytes) {
      files.set(`${imageId}/${size}`, bytes);
    },
    get keys() {
      return [...files.keys()];
    },
  };
}
