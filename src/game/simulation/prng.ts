import { SimulationError } from "./types";

const HASH_PATTERN = /^(?:0x)?([0-9a-fA-F]{64})$/;
const UINT32_RANGE = 0x1_0000_0000;

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function canonicalHash(blockHash: string): string {
  const match = HASH_PATTERN.exec(blockHash);
  if (!match) {
    throw new SimulationError(
      "INVALID_BLOCK_HASH",
      "Block hash must contain exactly 32 bytes of hexadecimal data.",
    );
  }

  return `0x${match[1].toLowerCase()}`;
}

/**
 * xoshiro128** with explicit 32-bit state. The algorithm name is part of the
 * replay contract; changing it requires a replay version bump.
 */
export class Xoshiro128StarStar {
  private state0: number;
  private state1: number;
  private state2: number;
  private state3: number;

  constructor(blockHash: string) {
    const hex = canonicalHash(blockHash).slice(2);
    const words = Array.from({ length: 8 }, (_, index) =>
      Number.parseInt(hex.slice(index * 8, index * 8 + 8), 16) >>> 0,
    );

    this.state0 = (words[0] ^ rotateLeft(words[4], 1)) >>> 0;
    this.state1 = (words[1] ^ rotateLeft(words[5], 7)) >>> 0;
    this.state2 = (words[2] ^ rotateLeft(words[6], 13)) >>> 0;
    this.state3 = (words[3] ^ rotateLeft(words[7], 19)) >>> 0;

    if ((this.state0 | this.state1 | this.state2 | this.state3) === 0) {
      this.state0 = 0x9e3779b9;
      this.state1 = 0x243f6a88;
      this.state2 = 0xb7e15162;
      this.state3 = 0x8aed2a6b;
    }
  }

  nextUint32(): number {
    const result = Math.imul(rotateLeft(Math.imul(this.state1, 5), 7), 9) >>> 0;
    const shifted = (this.state1 << 9) >>> 0;

    this.state2 = (this.state2 ^ this.state0) >>> 0;
    this.state3 = (this.state3 ^ this.state1) >>> 0;
    this.state1 = (this.state1 ^ this.state2) >>> 0;
    this.state0 = (this.state0 ^ this.state3) >>> 0;
    this.state2 = (this.state2 ^ shifted) >>> 0;
    this.state3 = rotateLeft(this.state3, 11);

    return result;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new SimulationError(
        "INVALID_PRNG_BOUND",
        "PRNG bounds must be positive integers.",
      );
    }

    const limit =
      UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let value = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return value % maxExclusive;
  }
}

export function normalizeBlockHash(blockHash: string): string {
  return canonicalHash(blockHash);
}
