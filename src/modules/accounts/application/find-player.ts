import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { PlayerNotFound } from "../domain/errors";
import type { Player } from "../domain/player";
import type { PlayerRepository } from "./ports";

/** Loads a player, turning "not there" into a PlayerNotFound error. */
export async function findPlayer(
  players: PlayerRepository,
  userId: UserId,
): Promise<Result<Player, PlayerNotFound>> {
  const player = await players.findById(userId);
  return player === null ? err({ kind: "PlayerNotFound" }) : ok(player);
}
