// A deck's boards (design doc 32). Its own file so every part of the domain can use it without
// importing the whole deck model.

/** A deck's boards. The maybeboard holds cards you're considering: counted nowhere (design doc 32). */
export const BOARDS = ["commander", "main", "side", "maybe"] as const;
export type Board = (typeof BOARDS)[number];

/** The boards a deck plays with: every board but the maybeboard. */
export const COUNTED_BOARDS = ["commander", "main", "side"] as const satisfies readonly Board[];
export type CountedBoard = (typeof COUNTED_BOARDS)[number];

/** Whether a board's cards count: in the deck's size, statistics, problems, proxies and copies used. */
export function isCounted(board: Board): board is CountedBoard {
  return board !== "maybe";
}

/** Whether a board's cards are played: the main deck and the commanders (not the sideboard). */
export function isPlayed(board: Board): boolean {
  return board === "main" || board === "commander";
}
