import { describe, expect, it } from "vitest";

import { Xoshiro128StarStar } from "./prng";

const HASH_A =
  "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const HASH_B =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

describe("Xoshiro128StarStar", () => {
  it("produces the same integer stream for the same block hash", () => {
    const left = new Xoshiro128StarStar(HASH_A);
    const right = new Xoshiro128StarStar(HASH_A);

    expect(Array.from({ length: 20 }, () => left.nextUint32())).toEqual(
      Array.from({ length: 20 }, () => right.nextUint32()),
    );
  });

  it("produces a different stream for a different block hash", () => {
    const left = new Xoshiro128StarStar(HASH_A);
    const right = new Xoshiro128StarStar(HASH_B);

    expect(Array.from({ length: 8 }, () => left.nextUint32())).not.toEqual(
      Array.from({ length: 8 }, () => right.nextUint32()),
    );
  });

  it("keeps bounded values inside the requested integer range", () => {
    const prng = new Xoshiro128StarStar(HASH_A);
    const values = Array.from({ length: 1_000 }, () => prng.nextInt(7));

    expect(values.every((value) => Number.isInteger(value))).toBe(true);
    expect(values.every((value) => value >= 0 && value < 7)).toBe(true);
  });

  it("rejects malformed seeds", () => {
    expect(() => new Xoshiro128StarStar("0x1234")).toThrowError(
      /exactly 32 bytes/,
    );
  });
});
