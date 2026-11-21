// "Is this card a land, a creature, a basic?" answered in one place (refactor P04), from the type
// line alone. P14 replaces this with CardFeatures. It lives in the kernel, not in catalog, because
// domains, queries and the browser may import the kernel but not another module (ADR 0009).

/** What a type line says about a card. */
export type CardTypes = Readonly<{
  /** The words of each face's type line: "Instant // Land — Forest" is [["Instant"], ["Land", "—", "Forest"]]. */
  faces: ReadonlyArray<readonly string[]>;
  /**
   * A land, by the owner's rule (STATUS decision 1): a card with a land on any face counts as a
   * land, so a spell with a land on its back ("Instant // Land") does.
   */
  isLand: boolean;
  /**
   * The front face is a land. Use it only where the front face is what is on the table (a
   * back-face land has to be turned over first), and say why in a comment.
   */
  isLandOnFront: boolean;
  /** A basic land ("Basic Land — Forest", "Basic Snow Land — Island"). */
  isBasic: boolean;
  /** A creature on any face. */
  isCreature: boolean;
}>;

const FACE_SEPARATOR = " // ";

export function cardTypes(typeLine: string): CardTypes {
  const faces = typeLine.split(FACE_SEPARATOR).map((face) => face.split(/\s+/).filter(Boolean));
  const isLandFace = (face: readonly string[]) => face.includes("Land");
  return {
    faces,
    isLand: faces.some(isLandFace),
    isLandOnFront: isLandFace(faces[0] ?? []),
    isBasic: faces.some((face) => face.includes("Basic") && isLandFace(face)),
    isCreature: faces.some((face) => face.includes("Creature")),
  };
}

// The same answers for a caller that has only the type line and wants one yes or no.
export const isLand = (typeLine: string) => cardTypes(typeLine).isLand;
export const isBasicLand = (typeLine: string) => cardTypes(typeLine).isBasic;
export const isCreature = (typeLine: string) => cardTypes(typeLine).isCreature;

/**
 * The creature types on the front face: "Creature — Elf Druid" and "Kindred Instant — Elf" both
 * give their Elf; a card with no creature type, or with one only on its back face, gives none.
 */
export function creatureTypes(typeLine: string): string[] {
  const [front = []] = cardTypes(typeLine).faces;
  const dash = front.indexOf("—");
  const hasCreatureType = ["Creature", "Kindred", "Tribal"].some((word) => front.includes(word));
  return dash >= 0 && hasCreatureType ? front.slice(dash + 1) : [];
}

// Any other type word ("Legendary", "Artifact", "Planeswalker", "Kindred"): the one place that
// reads a type line for a word. Words are matched whole and with their letter case.

/** Whether a face has one of these words: any face, or only the front face (`frontOnly`). */
export function hasTypeWord(
  typeLine: string,
  words: readonly string[],
  frontOnly = false,
): boolean {
  const { faces } = cardTypes(typeLine);
  const searched = frontOnly ? faces.slice(0, 1) : faces;
  return searched.some((face) => words.some((word) => face.includes(word)));
}
