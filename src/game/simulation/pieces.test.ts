import { describe, expect, it } from "vitest";

import { generatePieces, getPieceTemplate, rotateCells } from "./pieces";

const BLOCK_HASH =
  "0x172df36ab9d85f15158a999c791d208e5b5c0a8443c9b98e758fdc2a82524f44";
const TRANSACTIONS = Array.from({ length: 24 }, (_, index) => ({
  gasBucket: index % 16,
  feeBucket: (index * 3) % 16,
  inputBucket: (index * 5) % 8,
  valueBucket: (index * 7) % 8,
}));

describe("canonical pieces", () => {
  it("generates identical pieces from identical block data", () => {
    expect(generatePieces(BLOCK_HASH, TRANSACTIONS)).toEqual(
      generatePieces(BLOCK_HASH, TRANSACTIONS),
    );
  });

  it("changes the generated sequence when compact features change", () => {
    const changed = TRANSACTIONS.map((transaction, index) =>
      index === 0 ? { ...transaction, feeBucket: 15 } : transaction,
    );
    expect(generatePieces(BLOCK_HASH, changed)).not.toEqual(
      generatePieces(BLOCK_HASH, TRANSACTIONS),
    );
  });

  it("normalizes every quarter-turn and returns after four rotations", () => {
    const source = getPieceTemplate("TET_L");
    const rotations = [0, 1, 2, 3].map((rotation) =>
      rotateCells(source, rotation as 0 | 1 | 2 | 3),
    );

    for (const cells of rotations) {
      expect(Math.min(...cells.map((cell) => cell.x))).toBe(0);
      expect(Math.min(...cells.map((cell) => cell.y))).toBe(0);
    }
    expect(rotateCells(rotateCells(source, 3), 1)).toEqual(
      rotateCells(source, 0),
    );
    expect(new Set(rotations.map((cells) => JSON.stringify(cells))).size).toBe(
      4,
    );
  });

  it("keeps symmetric rotations canonical", () => {
    const square = getPieceTemplate("TET_O");
    expect(rotateCells(square, 0)).toEqual(rotateCells(square, 1));
    expect(rotateCells(square, 1)).toEqual(rotateCells(square, 2));
  });

  it("rejects out-of-range feature buckets", () => {
    expect(() =>
      generatePieces(BLOCK_HASH, [
        { gasBucket: 16, feeBucket: 0, inputBucket: 0, valueBucket: 0 },
      ]),
    ).toThrowError(/gasBucket/);
  });
});
