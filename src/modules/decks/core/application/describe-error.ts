import { assertNever } from "@/shared/kernel";
import type {
  CardNotFound,
  CommanderMove,
  CommentInvalid,
  CommentNotFound,
  DeckChanged,
  DeckNotFound,
  EntryNotFound,
  FinishNotAvailable,
  HeadingInvalid,
  HeadingNotFound,
  HeadingOrderInvalid,
  ListProblems,
  ListTooLong,
  NameInvalid,
  NotAllowed,
  NotThatToken,
  NoteInvalid,
  PrintingNotOfCard,
  QuantityInvalid,
  SnapshotLabelInvalid,
  SnapshotNotFound,
  TargetBracketInvalid,
  TargetBracketNotCommander,
  TokenNotInDeck,
  TooManyDecks,
  TooManyHeadings,
  TooManySnapshots,
} from "../domain/errors";

// What every expected failure of the decks module says, in one place (ADR 0026, audit S7). The
// deck builder shows these sentences to the player and the tool bindings hand them to the model,
// so a rule changes its wording once. The `switch` is exhaustive: a new error kind doesn't
// compile until it has a sentence.

export type DeckError =
  | DeckNotFound
  | NameInvalid
  | QuantityInvalid
  | TooManyDecks
  | CardNotFound
  | CommentInvalid
  | CommentNotFound
  | NotAllowed
  | TargetBracketInvalid
  | TargetBracketNotCommander
  | DeckChanged
  | ListProblems
  | ListTooLong
  | EntryNotFound
  | CommanderMove
  | PrintingNotOfCard
  | FinishNotAvailable
  | TokenNotInDeck
  | NotThatToken
  | HeadingInvalid
  | HeadingNotFound
  | HeadingOrderInvalid
  | TooManyHeadings
  | NoteInvalid
  | SnapshotNotFound
  | SnapshotLabelInvalid
  | TooManySnapshots;

export function describeDeckError(error: DeckError): string {
  switch (error.kind) {
    case "DeckNotFound":
      return "That deck isn't yours.";
    case "NameInvalid":
      return `Give the deck a name of up to ${error.maximum} characters.`;
    case "QuantityInvalid":
      return `Use 0 to ${error.maximum} copies.`;
    case "TooManyDecks":
      return `You can have at most ${error.maximum} decks. Delete one first.`;
    case "CardNotFound":
      return "That card isn't in the catalog.";
    case "CommentInvalid":
      return `A comment has 1 to ${error.maximum} characters.`;
    case "CommentNotFound":
      return "That comment isn't there any more.";
    case "NotAllowed":
      return "You can't do that.";
    case "TargetBracketInvalid":
      return "A target bracket is 1 to 5.";
    case "TargetBracketNotCommander":
      return "Only Commander decks have a target bracket.";
    case "DeckChanged":
      return "The deck changed meanwhile: load it again and retry.";
    case "ListProblems":
      return `Nothing was saved. Unreadable lines: ${JSON.stringify(error.unreadable)}. Cards not found: ${JSON.stringify(error.notFound)}.`;
    case "ListTooLong":
      return `A list may have up to ${error.maximumLines} lines.`;
    case "EntryNotFound":
      return "That card isn't on that board any more.";
    case "CommanderMove":
      return "Commanders stay where they are.";
    case "PrintingNotOfCard":
      return "That printing isn't of this card.";
    case "FinishNotAvailable":
      return "That printing doesn't come in that finish.";
    case "TokenNotInDeck":
      return "None of the deck's cards makes that token.";
    case "NotThatToken":
      return "That art isn't of this token.";
    case "HeadingInvalid":
      return `A heading starts with a letter, has at most ${error.maximum} characters, and isn't a board or card type ("Sideboard", "Creatures").`;
    case "HeadingNotFound":
      return "That heading isn't in the deck any more.";
    case "HeadingOrderInvalid":
      return "The headings changed meanwhile: try again.";
    case "TooManyHeadings":
      return `A deck can have at most ${error.maximum} headings.`;
    case "NoteInvalid":
      return `A note has 1 to ${error.maximum} characters (or "" to clear it).`;
    case "SnapshotNotFound":
      return "That snapshot isn't in this deck any more.";
    case "SnapshotLabelInvalid":
      return `Give the snapshot a label (up to ${error.maximum} characters).`;
    case "TooManySnapshots":
      return `A deck can have at most ${error.maximum} snapshots. Delete an older one first.`;
    default:
      return assertNever(error);
  }
}
