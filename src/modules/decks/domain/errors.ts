// Every expected failure in the decks module.
export type DeckNotFound = Readonly<{ kind: "DeckNotFound" }>;
export type NameInvalid = Readonly<{ kind: "NameInvalid"; maximum: number }>;
export type QuantityInvalid = Readonly<{ kind: "QuantityInvalid"; maximum: number }>;
export type TooManyDecks = Readonly<{ kind: "TooManyDecks"; maximum: number }>;
export type CardNotFound = Readonly<{ kind: "CardNotFound" }>;
export type CommentInvalid = Readonly<{ kind: "CommentInvalid"; maximum: number }>;
export type CommentNotFound = Readonly<{ kind: "CommentNotFound" }>;
export type NotAllowed = Readonly<{ kind: "NotAllowed" }>;
/** A target bracket isn't 1–5 (design doc 31). */
export type TargetBracketInvalid = Readonly<{ kind: "TargetBracketInvalid" }>;
/** Only Commander decks have a target bracket (design doc 31, invariant 8). */
export type TargetBracketNotCommander = Readonly<{ kind: "TargetBracketNotCommander" }>;
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
/** The deck has no line for this card on this board (design doc 24). */
export type EntryNotFound = Readonly<{ kind: "EntryNotFound" }>;
/** Commanders aren't moved between boards; choosing a commander is its own step (design doc 32). */
export type CommanderMove = Readonly<{ kind: "CommanderMove" }>;
/** The printing chosen is of another card, or isn't in the catalog (design doc 24, rule 3). */
export type PrintingNotOfCard = Readonly<{ kind: "PrintingNotOfCard" }>;
/** The printing doesn't come in the finish chosen (design doc 24, rule 3). */
export type FinishNotAvailable = Readonly<{ kind: "FinishNotAvailable" }>;
/** None of the deck's cards makes this token (design doc 25). */
export type TokenNotInDeck = Readonly<{ kind: "TokenNotInDeck" }>;
/** The art chosen is a printing of another token, or isn't in the catalog (design doc 25). */
export type NotThatToken = Readonly<{ kind: "NotThatToken" }>;
/** A heading is empty, too long, or a board's name (design doc 34). */
export type HeadingInvalid = Readonly<{ kind: "HeadingInvalid"; maximum: number }>;
/** The deck has no such heading (design doc 34). */
export type HeadingNotFound = Readonly<{ kind: "HeadingNotFound" }>;
/** An order of headings that leaves one out, names one twice, or names one the deck lacks. */
export type HeadingOrderInvalid = Readonly<{ kind: "HeadingOrderInvalid" }>;
/** A new heading past the most a deck may have (design doc 34). */
export type TooManyHeadings = Readonly<{ kind: "TooManyHeadings"; maximum: number }>;
/** A line note is empty or longer than the limit (design doc 41). */
export type NoteInvalid = Readonly<{ kind: "NoteInvalid"; maximum: number }>;
/** The deck has no such snapshot, or it belongs to someone else (design doc 41). */
export type SnapshotNotFound = Readonly<{ kind: "SnapshotNotFound" }>;
/** A snapshot label is empty or longer than the limit (design doc 41). */
export type SnapshotLabelInvalid = Readonly<{ kind: "SnapshotLabelInvalid"; maximum: number }>;
/** A deck already has the maximum number of saved snapshots (design doc 41). */
export type TooManySnapshots = Readonly<{ kind: "TooManySnapshots"; maximum: number }>;
