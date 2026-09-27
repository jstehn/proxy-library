import type { UserId } from "@/shared/kernel";
import type { Acquisition, CardGain } from "../domain/cards";

// Ports: what the collection needs from outside. Real version in ../infrastructure, fake in
// ../testing.

export interface CollectionRepository {
  /**
   * Adds copies to a player's collection and logs where they came from, in the caller's
   * transaction. `gains` are already combined, with positive quantities.
   */
  receive(userId: UserId, gains: readonly CardGain[], acquisition: Acquisition): Promise<void>;
}

/** The repositories that must share one transaction. */
export type CollectionServices = {
  collection: CollectionRepository;
};
