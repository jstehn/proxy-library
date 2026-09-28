import type { ActivityServices } from "@/modules/activity";
import type { CollectionServices } from "@/modules/collection";
import type { DecksServices } from "@/modules/decks";
import type { InventoryServices } from "@/modules/inventory";
import type { TradesServices } from "@/modules/trades";
import type { WalletServices } from "@/modules/wallet";
import type { Clock, UnitOfWork } from "@/shared/kernel";

// Ports: a reset owns no tables. It asks each module to clear its own part, all in one
// transaction (design doc 12).

export type ResetServices = Pick<TradesServices, "trades"> &
  WalletServices &
  Pick<InventoryServices, "items"> &
  CollectionServices &
  Pick<DecksServices, "decks"> &
  ActivityServices;

export type ResetDependencies = { unitOfWork: UnitOfWork<ResetServices>; clock: Clock };
