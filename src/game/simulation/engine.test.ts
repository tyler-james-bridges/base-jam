import { describe, expect, it } from "vitest";

import {
  cellAt,
  createGame,
  currentPiece,
  packedPercentage,
  placePiece,
  sealGame,
  spillPiece,
  undoLastAction,
  validatePlacement,
} from "./engine";

const BLOCK_HASH =
  "0x8453000000000000000000000000000000000000000000000000000000000001";
const TRANSACTIONS = Array.from({ length: 40 }, (_, index) => ({
  gasBucket: index % 16,
  feeBucket: (index + 2) % 16,
  inputBucket: (index + 4) % 8,
  valueBucket: (index + 6) % 8,
}));

describe("game engine", () => {
  it("rejects collisions, incorrect pieces, and out-of-bounds placements", () => {
    let state = createGame({
      blockHash: BLOCK_HASH,
      transactions: TRANSACTIONS,
    });
    const first = currentPiece(state);
    expect(first).not.toBeNull();

    expect(validatePlacement(state, "tx-nope", 0, 0, 0)).toMatchObject({
      valid: false,
      code: "WRONG_PIECE",
    });
    expect(validatePlacement(state, first!.id, -1, 0, 0)).toMatchObject({
      valid: false,
      code: "OUT_OF_BOUNDS",
    });

    state = placePiece(state, first!.id, 0, 0, 0);
    const second = currentPiece(state);
    expect(validatePlacement(state, second!.id, 0, 0, 0)).toMatchObject({
      valid: false,
      code: "OCCUPIED",
    });
  });

  it("restores exactly one previous placement and consumes the undo", () => {
    let state = createGame({
      blockHash: BLOCK_HASH,
      transactions: TRANSACTIONS.slice(0, 2),
    });
    const first = currentPiece(state)!;
    state = placePiece(state, first.id, 0, 0, 0);
    expect(packedPercentage(state)).toBe(first.cells.length);

    state = undoLastAction(state);
    expect(state.cursor).toBe(0);
    expect(state.placements).toHaveLength(0);
    expect(packedPercentage(state)).toBe(0);
    expect(state.undoAvailable).toBe(false);
    expect(() => undoLastAction(state)).toThrowError(/single undo/);
  });

  it("tracks spills and never allows a negative or unbounded score", () => {
    let state = createGame({
      blockHash: BLOCK_HASH,
      transactions: TRANSACTIONS,
    });

    while (currentPiece(state)) {
      state = spillPiece(state, currentPiece(state)!.id);
      expect(state.score.total).toBeGreaterThanOrEqual(0);
      expect(state.score.total).toBeLessThanOrEqual(40_000);
    }

    state = sealGame(state);
    expect(state.score.total).toBe(0);
    expect(packedPercentage(state)).toBe(0);
    expect(state.sealGrade).toBe("F");
  });

  it("keeps packed percentage within inclusive board bounds", () => {
    let state = createGame({
      blockHash: BLOCK_HASH,
      transactions: TRANSACTIONS,
    });

    while (currentPiece(state)) {
      const piece = currentPiece(state)!;
      let placed = false;
      for (let y = 0; y < 10 && !placed; y += 1) {
        for (let x = 0; x < 10 && !placed; x += 1) {
          for (const rotation of [0, 1, 2, 3] as const) {
            if (validatePlacement(state, piece.id, x, y, rotation).valid) {
              state = placePiece(state, piece.id, x, y, rotation);
              placed = true;
              break;
            }
          }
        }
      }
      if (!placed) state = spillPiece(state, piece.id);

      expect(packedPercentage(state)).toBeGreaterThanOrEqual(0);
      expect(packedPercentage(state)).toBeLessThanOrEqual(100);
      expect(state.score.total).toBeGreaterThanOrEqual(0);
      expect(state.score.total).toBeLessThanOrEqual(40_000);
    }
  });

  it("does not allow sealing while pieces remain or mutation after sealing", () => {
    let state = createGame({
      blockHash: BLOCK_HASH,
      transactions: TRANSACTIONS.slice(0, 1),
    });
    expect(() => sealGame(state)).toThrowError(/placed or spilled/);
    state = spillPiece(state, currentPiece(state)!.id);
    state = sealGame(state);

    expect(() => spillPiece(state, "tx-00")).toThrowError(/sealed game/);
    expect(() => cellAt(state, 10, 0)).toThrowError(/0 through 9/);
  });
});
