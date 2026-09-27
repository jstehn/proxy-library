// The wallet module's public API: the only file other modules and the app may import.
export type {
  AddOwnFundsError,
  CorrectBalanceError,
  GrantMoneyError,
} from "./application/manage-money";
export { makeWallet } from "./application/make-wallet";
export { receive, spend, type ReceiveInput, type SpendInput } from "./application/payments";
export type { Wallet } from "./application/make-wallet";
export type {
  EconomySettingsRepository,
  PlayerDirectory,
  WalletDependencies,
  WalletRepository,
  WalletServices,
} from "./application/ports";
export type { UpdateEconomySettingsError } from "./application/update-economy-settings";
export { MAX_ALLOWANCE_PERIOD_DAYS, nextPayday, type EconomySettings } from "./domain/economy";
export type { InsufficientFunds } from "./domain/errors";
export { MAX_ENTRY_AMOUNT, MAX_NOTE_LENGTH, type LedgerKind } from "./domain/ledger";
export {
  currentEconomySettings,
  playerMoney,
  walletHistory,
  walletSummary,
} from "./queries/wallet";
export type { PlayerMoney, WalletHistoryItem, WalletSummary } from "./queries/wallet";
