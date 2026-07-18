import type { HexString, LevelManifestV1, LevelPieceV1 } from "@/lib/base/types";
import {
  RHYTHM_BPM,
  RHYTHM_RUN_BARS,
  RHYTHM_SECONDS_PER_BAR,
  RHYTHM_STEP_SECONDS,
  RHYTHM_STEPS_PER_BAR,
  type RhythmBar,
  type RhythmChart,
  type RhythmColumn,
  type RhythmLane,
  type RhythmNote,
} from "./types";

const NOTES_PER_LANE = 3;
const NOTES_PER_BAR = NOTES_PER_LANE * 4;
const SLOT_STEPS = [3, 7, 11] as const;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString;

function hexByte(hash: string, index: number): number {
  const offset = 2 + (index % 32) * 2;
  const value = Number.parseInt(hash.slice(offset, offset + 2), 16);
  return Number.isFinite(value) ? value : 0;
}

function bigint(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : BigInt(0);
}

function gasRatio(level: LevelManifestV1): number {
  const used = bigint(level.source.gasUsed);
  const limit = bigint(level.source.gasLimit);
  if (limit <= BigInt(0)) return 0;
  return Math.min(1, Number((used * BigInt(10_000)) / limit) / 10_000);
}

function orderPieces(
  pieces: readonly LevelPieceV1[],
  blockHash: HexString,
): readonly LevelPieceV1[] {
  return [...pieces].sort((left, right) => {
    const leftKey =
      hexByte(left.hash, 0) ^
      hexByte(left.hash, 11) ^
      hexByte(blockHash, 3);
    const rightKey =
      hexByte(right.hash, 0) ^
      hexByte(right.hash, 11) ^
      hexByte(blockHash, 3);
    return leftKey - rightKey || left.hash.localeCompare(right.hash);
  });
}

function fallbackPiece(level: LevelManifestV1, index: number): LevelPieceV1 {
  const hash = (level.source.hash || ZERO_HASH) as HexString;
  return {
    id: `block-${level.source.number}-${index}`,
    hash,
    type: "block",
    from: `0x${"0".repeat(40)}` as HexString,
    to: null,
    value: level.source.baseFeePerGas,
    calldataBytes: index,
    selector: null,
    gasLimit: level.source.gasUsed,
    maxFeePerGas: level.source.baseFeePerGas,
    maxPriorityFeePerGas: null,
  };
}

function noteFor(
  level: LevelManifestV1,
  bar: number,
  lane: RhythmLane,
  slot: number,
  piece: LevelPieceV1,
): RhythmNote {
  const hashMix =
    hexByte(piece.hash, bar + lane) ^
    hexByte(level.source.hash, slot + lane * 3) ^
    piece.calldataBytes;
  const step = Math.min(
    RHYTHM_STEPS_PER_BAR - 2,
    SLOT_STEPS[slot] + (hashMix % 2),
  );
  const fee = bigint(piece.maxFeePerGas ?? "0");
  const feeWeight = Number(fee > BigInt(20_000_000) ? BigInt(20_000_000) : fee);
  const velocity = Math.min(
    1,
    0.42 + piece.calldataBytes / 8_192 + feeWeight / 40_000_000,
  );

  return {
    id: `${bar}:${lane}:${slot}:${piece.hash}`,
    bar,
    step,
    time: bar * RHYTHM_SECONDS_PER_BAR + step * RHYTHM_STEP_SECONDS,
    lane,
    column: ((hashMix + slot) % 3) as RhythmColumn,
    txHash: piece.hash,
    txId: piece.id,
    calldataBytes: piece.calldataBytes,
    gasLimit: piece.gasLimit,
    value: piece.value,
    velocity,
  };
}

export function createRhythmChart(
  inputLevels: readonly LevelManifestV1[],
  bars: number = RHYTHM_RUN_BARS,
): RhythmChart {
  if (inputLevels.length === 0) {
    throw new RangeError("A rhythm chart needs at least one Base level.");
  }
  if (!Number.isInteger(bars) || bars < 1 || bars > RHYTHM_RUN_BARS) {
    throw new RangeError(`Rhythm bars must be between 1 and ${RHYTHM_RUN_BARS}.`);
  }

  const levels = Array.from(
    { length: bars },
    (_, index) => inputLevels[index % inputLevels.length],
  );
  const chartBars: RhythmBar[] = [];
  const notes: RhythmNote[] = [];

  levels.forEach((level, bar) => {
    chartBars.push({
      index: bar,
      blockNumber: level.source.number,
      blockHash: level.source.hash,
      explorerUrl: level.source.explorerUrl,
      txCount: level.source.txCount,
      gasRatio: gasRatio(level),
      baseFeePerGas: level.source.baseFeePerGas,
    });

    const ordered = orderPieces(level.pieces, level.source.hash);
    const selected = Array.from({ length: NOTES_PER_BAR }, (_, index) =>
      ordered.length > 0
        ? ordered[index % ordered.length]
        : fallbackPiece(level, index),
    );

    selected.forEach((piece, index) => {
      const lane = (index % 4) as RhythmLane;
      const slot = Math.floor(index / 4);
      notes.push(noteFor(level, bar, lane, slot, piece));
    });
  });

  return {
    version: "base-jam-rhythm-v1",
    bpm: RHYTHM_BPM,
    stepsPerBar: RHYTHM_STEPS_PER_BAR,
    secondsPerBar: RHYTHM_SECONDS_PER_BAR,
    durationSeconds: bars * RHYTHM_SECONDS_PER_BAR,
    keyIndex: hexByte(levels[0].source.hash, 0) % 12,
    ranked: levels.every((level) => level.ranked),
    levels,
    bars: chartBars,
    notes,
  };
}

export function rhythmFocusLane(
  chart: RhythmChart,
  bar: number,
): RhythmLane {
  const safeBar = Math.max(0, Math.floor(bar));
  return ((chart.keyIndex + safeBar) % 4) as RhythmLane;
}
