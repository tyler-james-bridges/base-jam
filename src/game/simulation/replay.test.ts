import { describe, expect, it } from "vitest";

import {
  createGame,
  currentPiece,
  placePiece,
  sealGame,
  spillPiece,
} from "./engine";
import { createReplay, verifyReplay } from "./replay";

const BLOCK_HASH =
  "0x4db040f4e17615a841f74b35cc575765ea17826c76dc892b303bfa42bdb5de69";
const TRANSACTIONS = Array.from({ length: 8 }, (_, index) => ({
  gasBucket: index,
  feeBucket: 15 - index,
  inputBucket: index % 8,
  valueBucket: (index * 3) % 8,
}));

function completedReplay() {
  let state = createGame({
    blockHash: BLOCK_HASH,
    transactions: TRANSACTIONS,
  });
  const first = currentPiece(state)!;
  state = placePiece(state, first.id, 0, 0, 0);
  while (currentPiece(state)) {
    state = spillPiece(state, currentPiece(state)!.id);
  }
  state = sealGame(state);
  return createReplay(state);
}

describe("headless replay verification", () => {
  it("reconstructs and verifies a sealed game without a renderer", () => {
    const replay = completedReplay();
    const result = verifyReplay(replay);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.score.total).toBe(replay.expected.score);
      expect(result.fingerprint).toBe(replay.expected.fingerprint);
    }
  });

  it("rejects an invalid placement at the exact action index", () => {
    const replay = completedReplay();
    const tampered = {
      ...replay,
      actions: replay.actions.map((action, index) =>
        index === 0 && action.type === "place"
          ? { ...action, x: -1 }
          : action,
      ),
    };
    const result = verifyReplay(tampered);

    expect(result).toMatchObject({
      ok: false,
      error: { actionIndex: 0, code: "OUT_OF_BOUNDS" },
    });
  });

  it("rejects a changed expected score or fingerprint", () => {
    const replay = completedReplay();
    const tampered = {
      ...replay,
      expected: { ...replay.expected, score: replay.expected.score + 1 },
    };

    expect(verifyReplay(tampered)).toMatchObject({
      ok: false,
      error: { actionIndex: null, code: "EXPECTATION_MISMATCH" },
    });
  });

  it("rejects malformed, unsealed, and unknown-action replays", () => {
    expect(verifyReplay({ version: 99 })).toMatchObject({
      ok: false,
      error: { code: "INVALID_REPLAY" },
    });

    const replay = completedReplay();
    expect(
      verifyReplay({ ...replay, actions: replay.actions.slice(0, -1) }),
    ).toMatchObject({
      ok: false,
      error: { code: "GAME_NOT_SEALED" },
    });
    expect(
      verifyReplay({
        ...replay,
        actions: [{ type: "teleport" }],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_REPLAY" },
    });
  });
});
