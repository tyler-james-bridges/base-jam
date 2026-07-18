import type { CompactTransactionFeatures } from "@/game/simulation";

import type { LevelManifestV1, LevelPieceV1 } from "./types";

function integer(value: string | null): bigint {
  if (!value || !/^\d+$/.test(value)) {
    return BigInt(0);
  }
  return BigInt(value);
}

function gasBucket(piece: LevelPieceV1): number {
  const bucket = integer(piece.gasLimit) / BigInt(100_000);
  return Number(bucket > BigInt(15) ? BigInt(15) : bucket);
}

function feeBucket(piece: LevelPieceV1): number {
  const fee = integer(piece.maxFeePerGas);
  const bucket = fee / BigInt(1_000_000);
  return Number(bucket > BigInt(15) ? BigInt(15) : bucket);
}

function inputBucket(piece: LevelPieceV1): number {
  const bytes = piece.calldataBytes;
  if (bytes === 0) return 0;
  if (bytes <= 4) return 1;
  if (bytes <= 32) return 2;
  if (bytes <= 128) return 3;
  if (bytes <= 512) return 4;
  if (bytes <= 1_024) return 5;
  if (bytes <= 4_096) return 6;
  return 7;
}

function valueBucket(piece: LevelPieceV1): number {
  const value = integer(piece.value);
  if (value === BigInt(0)) return 0;
  if (value < BigInt("1000000000000")) return 1;
  if (value < BigInt("100000000000000")) return 2;
  if (value < BigInt("1000000000000000")) return 3;
  if (value < BigInt("10000000000000000")) return 4;
  if (value < BigInt("100000000000000000")) return 5;
  if (value < BigInt("1000000000000000000")) return 6;
  return 7;
}

export function levelPieceToSimulationFeatures(
  piece: LevelPieceV1,
): CompactTransactionFeatures {
  return {
    gasBucket: gasBucket(piece),
    feeBucket: feeBucket(piece),
    inputBucket: inputBucket(piece),
    valueBucket: valueBucket(piece),
  };
}

export function levelToSimulationTransactions(
  level: LevelManifestV1,
): readonly CompactTransactionFeatures[] {
  return level.pieces.map(levelPieceToSimulationFeatures);
}
