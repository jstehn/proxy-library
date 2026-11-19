import { getAccountBinding } from "./get-account";
import { listDecksBinding } from "./list-decks";

/** Every ported tool. The registry serves these first, then the old tools for the rest. */
export const BINDINGS = [getAccountBinding, listDecksBinding];
