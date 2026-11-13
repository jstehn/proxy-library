// Pure text preparation for card embeddings (design doc 53, #58).

export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMS = 384;
export const EMBEDDING_TEXT_VERSION = 1;

/**
 * Normalizes a card's rules text for embedding: puts the type line first, strips reminder text
 * in parentheses, and replaces self-references to the card's name (and comma-prefix short name)
 * with `~`.
 */
export function cleanCardText(name: string, typeLine: string, text: string): string {
  let cleaned = text.replace(/\([^)]*\)/g, "");
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(escaped, "g"), "~");
    const shortName = name.split(",")[0]?.trim();
    if (shortName && shortName.length >= 4 && shortName !== name) {
      const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(new RegExp(`\\b${escapedShort}\\b`, "g"), "~");
    }
  }
  cleaned = cleaned
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return cleaned ? `${typeLine}\n${cleaned}` : typeLine;
}
