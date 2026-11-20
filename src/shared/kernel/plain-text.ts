// The one way a card's rules text is made plain before anything reads it (design doc 66): reminder
// text in parentheses goes, and the card's own names become "~".

/**
 * Rules text without reminder text ("(… draw a card …)" in a keyword's reminder is not a rule), and
 * with each of the card's face names, and the part of a name before a comma, as "~".
 */
export function plainText(text: string, faceNames: readonly string[] = []): string {
  const names = faceNames.flatMap((name) => [name, name.split(",")[0] ?? ""]);
  let plain = text.replace(/\([^)]*\)/g, "");
  // Longest first, so "Ojer Kaslem, Deepest Growth" goes before the "Ojer Kaslem" inside it.
  for (const name of names.filter((name) => name.length >= 3).sort((a, b) => b.length - a.length)) {
    plain = plain.split(name).join("~");
  }
  return plain;
}
