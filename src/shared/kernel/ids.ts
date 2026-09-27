import type { Brand } from "./brand";

// Ids used across many modules live here. Module-specific ids (PrintingId, TradeId, ...)
// live in their owning module.

export type UserId = Brand<string, "UserId">;

export const UserId = {
  of(value: string): UserId {
    if (value.length === 0) throw new RangeError("UserId must be non-empty");
    return value as UserId;
  },
};
