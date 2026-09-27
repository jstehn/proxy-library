import type { Result, UserId } from "@/shared/kernel";
import type { Acquisition, CardGain } from "../domain/cards";
import type { NotEnoughCopies } from "../domain/errors";

// Ports: what the collection needs from outside. Real version in ../infrastructure, fake in
// ../testing.

export interface CollectionRepository {
  /**
   * Adds copies to a player's collection and logs where they came from, in the caller's
   * transaction. `gains` are already combined, with positive quantities.
   */
  receive(userId: UserId, gains: readonly CardGain[], acquisition: Acquisition): Promise<void>;
  /**
   * Takes copies out of a player's collection and logs them (as negative quantities), in the
   * caller's transaction. Locks the rows first, and changes nothing unless the player owns
   * enough of every card. `losses` are combined, with positive quantities.
   */
  remove(
    userId: UserId,
    losses: readonly CardGain[],
    acquisition: Acquisition,
  ): Promise<Result<void, NotEnoughCopies>>;
}

/** The repositories that must share one transaction. */
export type CollectionServices = {
  collection: CollectionRepository;
};
