import {
  checkThemeId,
  ok,
  type Result,
  type ThemeError,
  type ThemePreference,
  type UserId,
} from "@/shared/kernel";
import type { SocialDependencies } from "./ports";

export type UpdateThemePreferenceInput = Readonly<{
  themeId: string;
  showBackdrop: boolean;
}>;

export type UpdateThemePreferenceError = ThemeError;

export function makeUpdateThemePreference({ unitOfWork, clock }: SocialDependencies) {
  return async function updateThemePreference(
    userId: UserId,
    input: UpdateThemePreferenceInput,
  ): Promise<Result<ThemePreference, UpdateThemePreferenceError>> {
    const checked = checkThemeId(input.themeId);
    if (!checked.ok) return checked;

    const preference: ThemePreference = {
      themeId: checked.value,
      showBackdrop: input.showBackdrop,
    };

    return unitOfWork.run<ThemePreference, UpdateThemePreferenceError>(async (services) => {
      await services.profiles.saveThemePreference(userId, preference, clock.now());
      return ok(preference);
    });
  };
}
