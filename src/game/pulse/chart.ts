import type { HexString, LevelManifestV1 } from "@/lib/base/types";
import {
  PULSE_BPM,
  PULSE_RUN_BLOCKS,
  PULSE_SECONDS_PER_BLOCK,
  type PulseChart,
  type PulseCue,
  type PulseEvent,
  type PulseLayer,
  type PulseRoute,
} from "./types";

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

function eventFor(level: LevelManifestV1, index: number): PulseEvent {
  const pieceIndex =
    level.pieces.length > 0
      ? hexByte(level.source.hash, index) % level.pieces.length
      : 0;
  const piece = level.pieces[pieceIndex];
  const signalHash = (piece?.hash ?? level.source.hash ?? ZERO_HASH) as HexString;

  return {
    id: `pulse:${index}:${level.source.hash}`,
    index,
    time: index * PULSE_SECONDS_PER_BLOCK,
    blockNumber: level.source.number,
    blockHash: level.source.hash,
    explorerUrl: level.source.explorerUrl,
    txCount: level.source.txCount,
    gasRatio: gasRatio(level),
    calldataBytes: piece?.calldataBytes ?? 0,
    signalHash,
    signalLayer: (hexByte(signalHash, index + 7) % 4) as PulseLayer,
  };
}

export function pulseCueCountForEvent(index: number): 2 | 3 | 4 {
  return index < 2 ? 2 : index < 7 ? 3 : 4;
}

function cueFor(
  event: PulseEvent,
  index: number,
  phraseIndex: number,
  count: 2 | 3 | 4,
): PulseCue {
  const routeSeed = hexByte(event.blockHash, phraseIndex * 5 + event.index);
  const laneSeed = hexByte(event.signalHash, phraseIndex * 7 + event.index + 3);
  const energySeed = hexByte(
    event.signalHash,
    phraseIndex * 11 + event.index + 13,
  );
  const offset = ((phraseIndex + 1) * PULSE_SECONDS_PER_BLOCK) / (count + 1);

  return {
    id: `cue:${event.index}:${phraseIndex}:${event.blockHash}`,
    index,
    eventIndex: event.index,
    phraseIndex,
    time: event.time + offset,
    route: ([-1, 0, 1] as const)[routeSeed % 3] as PulseRoute,
    lane: (laneSeed % 3) as 0 | 1 | 2,
    energy: Number(
      Math.min(
        1,
        0.35 + event.gasRatio * 0.35 + (energySeed / 255) * 0.3,
      ).toFixed(3),
    ),
  };
}

export function createPulseChart(
  inputLevels: readonly LevelManifestV1[],
  blocks: number = PULSE_RUN_BLOCKS,
): PulseChart {
  if (inputLevels.length === 0) {
    throw new RangeError("A pulse chart needs at least one Base level.");
  }
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > PULSE_RUN_BLOCKS) {
    throw new RangeError(
      `Pulse blocks must be between 1 and ${PULSE_RUN_BLOCKS}.`,
    );
  }

  const levels = Array.from(
    { length: blocks },
    (_, index) => inputLevels[index % inputLevels.length],
  );
  const events = levels.map(eventFor);
  let cueIndex = 0;
  const cues = events.flatMap((event) => {
    const count = pulseCueCountForEvent(event.index);
    return Array.from({ length: count }, (_, phraseIndex) =>
      cueFor(event, cueIndex++, phraseIndex, count),
    );
  });

  return {
    version: "base-jam-pulse-v2",
    bpm: PULSE_BPM,
    secondsPerBlock: PULSE_SECONDS_PER_BLOCK,
    durationSeconds: blocks * PULSE_SECONDS_PER_BLOCK,
    keyIndex: hexByte(levels[0].source.hash, 0) % 12,
    ranked: levels.every((level) => level.ranked),
    levels,
    events,
    cues,
  };
}
