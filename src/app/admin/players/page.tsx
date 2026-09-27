import { listPlayers } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { PlayerRow } from "./player-row";

export default async function AdminPlayersPage() {
  const admin = await requireAdminActor();
  const players = await listPlayers(getContainer().db);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Players</h1>
      <ul className="flex flex-col gap-3">
        {players.map((player) => (
          <PlayerRow key={player.userId} player={player} isYou={player.userId === admin.userId} />
        ))}
      </ul>
    </main>
  );
}
