import { applyAction, createGame, packedPercentage } from "./engine";
import {
  REPLAY_VERSION,
  type GameReplay,
  type GameState,
  type ReplayAction,
  type ReplayVerification,
  SimulationError,
} from "./types";

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function stateFingerprint(state: GameState): string {
  const board = state.board
    .map((pieceId) => pieceId ?? "-")
    .join(",");
  const placements = state.placements
    .map(
      (placement) =>
        `${placement.pieceId}:${placement.x}:${placement.y}:${placement.rotation}`,
    )
    .join("|");
  const canonical = [
    REPLAY_VERSION,
    state.blockHash,
    board,
    placements,
    state.spilled.join(","),
    state.score.total,
    packedPercentage(state),
    state.sealGrade ?? "-",
    state.undoAvailable ? 1 : 0,
  ].join(";");

  return `bjam1-${fnv1a32(canonical)}`;
}

export function createReplay(state: GameState): GameReplay {
  if (!state.sealed || !state.sealGrade) {
    throw new SimulationError(
      "GAME_NOT_SEALED",
      "Only sealed games can be exported as verified replays.",
    );
  }

  return {
    version: REPLAY_VERSION,
    blockHash: state.blockHash,
    transactions: state.transactions.map((features) => ({ ...features })),
    actions: state.actions.map((action) => ({ ...action })),
    expected: {
      score: state.score.total,
      packedPercentage: packedPercentage(state),
      sealGrade: state.sealGrade,
      fingerprint: stateFingerprint(state),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function actionShapeIsValid(action: unknown): action is ReplayAction {
  if (!isRecord(action) || typeof action.type !== "string") {
    return false;
  }
  if (action.type === "undo" || action.type === "seal") {
    return true;
  }
  if (action.type === "spill") {
    return typeof action.pieceId === "string";
  }
  if (action.type === "place") {
    return (
      typeof action.pieceId === "string" &&
      Number.isInteger(action.x) &&
      Number.isInteger(action.y) &&
      Number.isInteger(action.rotation) &&
      Number(action.rotation) >= 0 &&
      Number(action.rotation) <= 3
    );
  }
  return false;
}

function replayShapeIsValid(value: unknown): value is GameReplay {
  if (!isRecord(value)) return false;
  if (
    value.version !== REPLAY_VERSION ||
    typeof value.blockHash !== "string" ||
    !Array.isArray(value.transactions) ||
    !Array.isArray(value.actions) ||
    !value.actions.every(actionShapeIsValid) ||
    !isRecord(value.expected)
  ) {
    return false;
  }

  return (
    typeof value.expected.score === "number" &&
    Number.isInteger(value.expected.score) &&
    typeof value.expected.packedPercentage === "number" &&
    Number.isInteger(value.expected.packedPercentage) &&
    typeof value.expected.sealGrade === "string" &&
    typeof value.expected.fingerprint === "string"
  );
}

export function verifyReplay(replay: unknown): ReplayVerification {
  if (!replayShapeIsValid(replay)) {
    return {
      ok: false,
      error: {
        actionIndex: null,
        code: "INVALID_REPLAY",
        message: "Replay data does not match version 1 of the BASE JAM format.",
      },
    };
  }

  let state: GameState;
  try {
    state = createGame({
      blockHash: replay.blockHash,
      transactions: replay.transactions,
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        actionIndex: null,
        code:
          error instanceof SimulationError ? error.code : "INVALID_REPLAY_SEED",
        message:
          error instanceof Error ? error.message : "Replay seed is invalid.",
      },
    };
  }

  for (let index = 0; index < replay.actions.length; index += 1) {
    try {
      state = applyAction(state, replay.actions[index]);
    } catch (error) {
      return {
        ok: false,
        error: {
          actionIndex: index,
          code: error instanceof SimulationError ? error.code : "ACTION_FAILED",
          message:
            error instanceof Error ? error.message : "Replay action failed.",
        },
      };
    }
  }

  if (!state.sealed || !state.sealGrade) {
    return {
      ok: false,
      error: {
        actionIndex: replay.actions.length,
        code: "GAME_NOT_SEALED",
        message: "A verified replay must end with a seal action.",
      },
    };
  }

  const fingerprint = stateFingerprint(state);
  if (
    replay.expected.score !== state.score.total ||
    replay.expected.packedPercentage !== packedPercentage(state) ||
    replay.expected.sealGrade !== state.sealGrade ||
    replay.expected.fingerprint !== fingerprint
  ) {
    return {
      ok: false,
      error: {
        actionIndex: null,
        code: "EXPECTATION_MISMATCH",
        message: "Replay result does not match its expected sealed state.",
      },
    };
  }

  return { ok: true, state, fingerprint };
}
