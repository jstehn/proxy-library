import {
  inMemoryAccessTokenRepository,
  inMemoryInviteRepository,
  inMemoryPlayerRepository,
} from "./fakes";
import { describeRepositoryContracts } from "./repository.contract";

describeRepositoryContracts("in memory", async () => ({
  players: inMemoryPlayerRepository(),
  invites: inMemoryInviteRepository(),
  accessTokens: inMemoryAccessTokenRepository(),
  createIdentity: async () => {},
}));
