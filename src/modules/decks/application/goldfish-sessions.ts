import { err, ok, type Result, type Rng, type UserId } from "@/shared/kernel";
import type { DeckId } from "../domain/deck";
import {
  buildGoldfishDeck,
  peekLibrary,
  startGoldfishState,
  stepGoldfishState,
  type GoldfishAction,
  type GoldfishCard,
  type GoldfishDeckLine,
  type GoldfishError,
  type GoldfishState,
} from "../domain/goldfish-session";
import type { GoldfishSessionsDependencies } from "./ports";

export const GOLDFISH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_GOLDFISH_SESSIONS_PER_USER = 10;

export type SessionNotFound = Readonly<{ kind: "SessionNotFound" }>;
export type GoldfishSessionError = GoldfishError | SessionNotFound;

export type GoldfishSessionResult = Readonly<{
  sessionId: string;
  deckId: DeckId;
  state: GoldfishState;
  expiresAt: Date;
}>;

export type GoldfishStepInput =
  { kind: "action"; action: GoldfishAction } | { kind: "peek_library"; count: number };

export function makeGoldfishSessions(dependencies: GoldfishSessionsDependencies) {
  const { unitOfWork, clock, newSessionId } = dependencies;

  async function start(input: {
    userId: UserId;
    deckId: DeckId;
    format: string;
    lines: readonly GoldfishDeckLine[];
    rng: Rng;
    onTheDraw?: boolean;
    freeMulligan?: boolean;
  }): Promise<Result<GoldfishSessionResult, GoldfishError>> {
    const deck = buildGoldfishDeck(input.lines);
    const started = startGoldfishState(deck, {
      format: input.format,
      rng: input.rng,
      onTheDraw: input.onTheDraw,
      freeMulligan: input.freeMulligan,
    });
    if (!started.ok) return started;

    return unitOfWork.run<GoldfishSessionResult, GoldfishError>(async ({ goldfishSessions }) => {
      const now = clock.now();
      const expiresAt = new Date(now.getTime() + GOLDFISH_SESSION_TTL_MS);
      await goldfishSessions.pruneExpired(now);
      await goldfishSessions.enforceUserCap(input.userId, MAX_GOLDFISH_SESSIONS_PER_USER - 1);
      const sessionId = newSessionId();
      await goldfishSessions.create({
        id: sessionId,
        userId: input.userId,
        deckId: input.deckId,
        state: started.value,
        updatedAt: now,
        expiresAt,
      });
      return ok({ sessionId, deckId: input.deckId, state: started.value, expiresAt });
    });
  }

  async function step(input: {
    userId: UserId;
    sessionId: string;
    step: GoldfishStepInput;
  }): Promise<
    Result<GoldfishSessionResult & { peeked?: readonly GoldfishCard[] }, GoldfishSessionError>
  > {
    return unitOfWork.run<
      GoldfishSessionResult & { peeked?: readonly GoldfishCard[] },
      GoldfishSessionError
    >(async ({ goldfishSessions }) => {
      const now = clock.now();
      const record = await goldfishSessions.findById(input.sessionId, input.userId, now);
      if (!record) return err({ kind: "SessionNotFound" });

      const expiresAt = new Date(now.getTime() + GOLDFISH_SESSION_TTL_MS);
      if (input.step.kind === "peek_library") {
        const peeked = peekLibrary(record.state, input.step.count);
        await goldfishSessions.save(record.id, input.userId, record.state, now, expiresAt);
        return ok({
          sessionId: record.id,
          deckId: record.deckId,
          state: record.state,
          expiresAt,
          peeked,
        });
      }

      const next = stepGoldfishState(record.state, input.step.action);
      if (!next.ok) return next;
      await goldfishSessions.save(record.id, input.userId, next.value, now, expiresAt);
      return ok({
        sessionId: record.id,
        deckId: record.deckId,
        state: next.value,
        expiresAt,
      });
    });
  }

  async function pruneExpired(): Promise<number> {
    const result = await unitOfWork.run<number, never>(async ({ goldfishSessions }) =>
      ok(await goldfishSessions.pruneExpired(clock.now())),
    );
    return result.ok ? result.value : 0;
  }

  return { start, step, pruneExpired };
}

export type GoldfishSessions = ReturnType<typeof makeGoldfishSessions>;
