import { describe, expect, it } from "vitest";

import {
  createBaseManifest,
  createPracticeManifest,
} from "./manifest";
import { MAX_LEVEL_PIECES } from "./types";

function hex(value: number, bytes = 32): `0x${string}` {
  return `0x${value.toString(16).padStart(bytes * 2, "0")}`;
}

function transaction(index: number, typeHex = "0x2") {
  return {
    transactionIndex: index,
    hash: hex(index + 10),
    type: typeHex === "0x7e" ? "deposit" : "eip1559",
    typeHex,
    from: hex(index + 100, 20),
    to: hex(index + 200, 20),
    value: BigInt(index * 1_000),
    input: index % 2 === 0 ? "0x" : (`0x12345678${"ab".repeat(index)}` as const),
    gas: BigInt(21_000 + index * 1_000),
    maxFeePerGas: BigInt(1_000_000 + index),
    maxPriorityFeePerGas: BigInt(index),
  };
}

function blockWithTransactions(transactions: readonly ReturnType<typeof transaction>[]) {
  return {
    number: BigInt(1_000),
    hash: hex(1),
    parentHash: hex(2),
    transactionsRoot: hex(3),
    timestamp: BigInt(1_700_000_000),
    gasUsed: BigInt(10_000_000),
    gasLimit: BigInt(30_000_000),
    baseFeePerGas: BigInt(1_000_000),
    transactions,
  } as unknown as Parameters<typeof createBaseManifest>[0];
}

describe("BASE JAM Base level manifests", () => {
  it("excludes 0x7e deposits and samples no more than 24 pieces deterministically", () => {
    const transactions = [
      transaction(0, "0x7e"),
      ...Array.from({ length: 40 }, (_, index) => transaction(index + 1)),
    ];
    const block = blockWithTransactions(transactions);
    const first = createBaseManifest(block, { tip: BigInt(1_003) });
    const second = createBaseManifest(block, { tip: BigInt(1_003) });

    expect(first.ranked).toBe(true);
    expect(first.rulesetVersion).toBe("base-jam-v1");
    expect(first.pieces).toHaveLength(MAX_LEVEL_PIECES);
    expect(first.pieces.every((piece) => piece.type !== "0x7e")).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.pieces)).toBe(true);
  });

  it("makes deterministic practice data explicit and never ranked", () => {
    const first = createPracticeManifest({
      reason: "offline",
      now: new Date("2026-07-18T12:00:00.000Z"),
    });
    const second = createPracticeManifest({
      reason: "different display copy",
      now: new Date("2026-07-18T23:59:59.000Z"),
    });

    expect(first.source.kind).toBe("practice");
    expect(first.source.explorerUrl).toBe("");
    expect(first.ranked).toBe(false);
    expect(first.digest).toBe(second.digest);
    expect(first.pieces).toEqual(second.pieces);
  });
});
