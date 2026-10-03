// Every expected failure in the decks module.
export type DeckNotFound = Readonly<{ kind: "DeckNotFound" }>;
export type NameInvalid = Readonly<{ kind: "NameInvalid"; maximum: number }>;
export type QuantityInvalid = Readonly<{ kind: "QuantityInvalid"; maximum: number }>;
export type TooManyDecks = Readonly<{ kind: "TooManyDecks"; maximum: number }>;
export type CardNotFound = Readonly<{ kind: "CardNotFound" }>;
export type CommentInvalid = Readonly<{ kind: "CommentInvalid"; maximum: number }>;
export type CommentNotFound = Readonly<{ kind: "CommentNotFound" }>;
export type NotAllowed = Readonly<{ kind: "NotAllowed" }>;
