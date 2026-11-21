import { Cents } from "@/shared/kernel";
import { PlayerRow } from "./player-row";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";

export default async function AdminPlayersPage() {
  const { actor: admin, capabilities, reads } = await readPage({ admin: true });
  const { wallet } = capabilities;

  // Pay due allowances (and open new wallets) first, so the balances shown are current.
  await wallet.refreshAllWallets(admin);
  const [players, money] = await Promise.all([
    reads.accounts.listPlayers(admin),
    reads.wallet.playerMoney(admin),
  ]);
  const moneyByPlayer = new Map(money.map((entry) => [entry.userId, entry]));

  return (
    <Page width="3xl">
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
    </Page>
  );
}
