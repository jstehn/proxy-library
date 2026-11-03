// Every expected failure in the decks module.
export type DeckNotFound = Readonly<{ kind: "DeckNotFound" }>;
export type NameInvalid = Readonly<{ kind: "NameInvalid"; maximum: number }>;
export type QuantityInvalid = Readonly<{ kind: "QuantityInvalid"; maximum: number }>;
export type TooManyDecks = Readonly<{ kind: "TooManyDecks"; maximum: number }>;
export type CardNotFound = Readonly<{ kind: "CardNotFound" }>;
export type CommentInvalid = Readonly<{ kind: "CommentInvalid"; maximum: number }>;
export type CommentNotFound = Readonly<{ kind: "CommentNotFound" }>;
export type NotAllowed = Readonly<{ kind: "NotAllowed" }>;
/** The deck changed after its text box was filled (design doc 23, rule 5). */
export type DeckChanged = Readonly<{ kind: "DeckChanged" }>;
/** Lines a list save couldn't use; nothing was saved (design doc 23, rule 1). */
export type ListProblems = Readonly<{
  kind: "ListProblems";
  /** Lines the list reader couldn't understand. */
  unreadable: string[];
  /** Card names the catalog doesn't have. */
  notFound: string[];
}>;
export type ListTooLong = Readonly<{ kind: "ListTooLong"; maximumLines: number }>;
