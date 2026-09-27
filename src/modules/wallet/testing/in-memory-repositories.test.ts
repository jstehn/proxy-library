import { UserId } from "@/shared/kernel";
import { inMemoryEconomySettingsRepository, inMemoryWalletRepository } from "./fakes";
import { describeWalletRepositoryContracts } from "./repository.contract";

describeWalletRepositoryContracts("in memory", async () => ({
  wallets: inMemoryWalletRepository(),
  economy: inMemoryEconomySettingsRepository(),
  createPlayer: async (id) => UserId.of(id),
}));
