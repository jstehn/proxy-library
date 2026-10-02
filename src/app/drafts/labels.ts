// How draft settings are described to players.

const BOOSTER_NAMES: Readonly<Record<string, string>> = {
  play: "Play Booster",
  draft: "Draft Booster",
  default: "Booster",
};

export function boosterLabel(boosterType: string): string {
  return BOOSTER_NAMES[boosterType] ?? boosterType;
}

export function timerLabel(secondsPerPick: number | null): string {
  if (secondsPerPick === null) return "no pick timer";
  if (secondsPerPick % 60 === 0) {
    const minutes = secondsPerPick / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"} a pick`;
  }
  return `${secondsPerPick} seconds a pick`;
}

/** Seconds as "1:05" for a countdown. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
