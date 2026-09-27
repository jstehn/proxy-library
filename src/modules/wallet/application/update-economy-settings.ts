import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import { checkSettings, type EconomySettings } from "../domain/economy";
import type { Forbidden, SettingsInvalid } from "../domain/errors";
import type { WalletDependencies } from "./ports";
import { bringUpToDate } from "./refresh";

export type UpdateEconomySettingsError = Forbidden | SettingsInvalid;

/**
 * An admin changes the economy settings. Rule 9: changes apply from now on, so every wallet is
 * first paid up under the OLD settings, then the new ones are saved, all in one transaction.
 */
export function makeUpdateEconomySettings(dependencies: WalletDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function updateEconomySettings(
    actor: Actor,
    input: EconomySettings,
  ): Promise<Result<EconomySettings, UpdateEconomySettingsError>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    const settings = checkSettings(input);
    if (!settings.ok) return settings;

    return unitOfWork.run<EconomySettings, UpdateEconomySettingsError>(async (services) => {
      const oldSettings = await services.economy.lockAndGet();
      const now = clock.now();

      for (const userId of await services.playerDirectory.allPlayerIds()) {
        await bringUpToDate(services, userId, now, oldSettings);
      }

      await services.economy.save(settings.value, actor.userId);
      return ok(settings.value);
    });
  }

  return updateEconomySettings;
}
