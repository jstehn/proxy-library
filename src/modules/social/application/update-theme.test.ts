import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { fakeSocialServices } from "../testing/fakes";
import { makeUpdateThemePreference } from "./update-theme";

describe("updateThemePreference", () => {
  it("persists a valid theme and backdrop preference", async () => {
    const services = fakeSocialServices();
    const updateThemePreference = makeUpdateThemePreference({
      unitOfWork: inMemoryUnitOfWork(services),
      clock: fixedClock("2026-11-27T18:00:00Z"),
    });
    const userId = UserId.of("user-1");

    const saved = await updateThemePreference(userId, {
      themeId: "bloomburrow",
      showBackdrop: false,
    });

    expect(saved).toEqual({
      ok: true,
      value: { themeId: "bloomburrow", showBackdrop: false },
    });
  });

  it("rejects an unknown theme id without saving", async () => {
    const services = fakeSocialServices();
    const updateThemePreference = makeUpdateThemePreference({
      unitOfWork: inMemoryUnitOfWork(services),
      clock: fixedClock("2026-11-27T18:00:00Z"),
    });

    const saved = await updateThemePreference(UserId.of("user-1"), {
      themeId: "not-a-real-plane",
      showBackdrop: true,
    });

    expect(saved).toEqual({
      ok: false,
      error: { kind: "UnknownTheme", themeId: "not-a-real-plane" },
    });
  });
});
