import { listPlayers } from "@/modules/accounts";
import { playerMoney } from "@/modules/wallet";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { PlayerRow } from "./player-row";

export default async function AdminPlayersPage() {
  const admin = await requireAdminActor();
  const { db, wallet } = getContainer();

  // Pay due allowances (and open new wallets) first, so the balances shown are current.
  await wallet.refreshAllWallets();
  const [players, money] = await Promise.all([listPlayers(db), playerMoney(db)]);
  const moneyByPlayer = new Map(money.map((entry) => [entry.userId, entry]));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Players</h1>
      <ul className="flex flex-col gap-3">
        {players.map((player) => {
          const totals = moneyByPlayer.get(player.userId);
          return (
            <PlayerRow
              key={player.userId}
              player={player}
              isYou={player.userId === admin.userId}
              money={{
                balance: Cents.format(totals?.balance ?? Cents.zero),
                spent: Cents.format(totals?.spent ?? Cents.zero),
                selfFunded: Cents.format(totals?.selfFunded ?? Cents.zero),
              }}
            />
          );
        })}
      </ul>
    </main>
  );
}
