import type { HexString, LevelManifestV1 } from "@/lib/base/types";

export const RHYTHM_BPM = 120 as const;
export const RHYTHM_STEPS_PER_BAR = 16 as const;
export const RHYTHM_SECONDS_PER_BAR = 2 as const;
export const RHYTHM_STEP_SECONDS =
  RHYTHM_SECONDS_PER_BAR / RHYTHM_STEPS_PER_BAR;
export const RHYTHM_RUN_BARS = 15 as const;
export const RHYTHM_RUN_SECONDS =
  RHYTHM_RUN_BARS * RHYTHM_SECONDS_PER_BAR;

export const RHYTHM_LANES = [
  { id: 0, name: "DRUMS", color: "#181818", signal: "transfers" },
  { id: 1, name: "BASS", color: "#b6d81d", signal: "value" },
  { id: 2, name: "SYNTH", color: "#1456f0", signal: "contract calls" },
  { id: 3, name: "FX", color: "#8f62d8", signal: "calldata" },
] as const;

export type RhythmLane = (typeof RHYTHM_LANES)[number]["id"];
export type RhythmColumn = 0 | 1 | 2;
export type RhythmJudgement = "perfect" | "good" | "miss";

export interface RhythmNote {
  readonly id: string;
  readonly bar: number;
  readonly step: number;
  readonly time: number;
  readonly lane: RhythmLane;
  readonly column: RhythmColumn;
  readonly txHash: HexString;
  readonly txId: string;
  readonly calldataBytes: number;
  readonly gasLimit: string;
  readonly value: string;
  readonly velocity: number;
}

export interface RhythmBar {
  readonly index: number;
  readonly blockNumber: string;
  readonly blockHash: HexString;
  readonly explorerUrl: string;
  readonly txCount: number;
  readonly gasRatio: number;
  readonly baseFeePerGas: string;
}

export interface RhythmChart {
  readonly version: "base-jam-rhythm-v1";
  readonly bpm: typeof RHYTHM_BPM;
  readonly stepsPerBar: typeof RHYTHM_STEPS_PER_BAR;
  readonly secondsPerBar: typeof RHYTHM_SECONDS_PER_BAR;
  readonly durationSeconds: number;
  readonly keyIndex: number;
  readonly ranked: boolean;
  readonly levels: readonly LevelManifestV1[];
  readonly bars: readonly RhythmBar[];
  readonly notes: readonly RhythmNote[];
}

export interface RhythmState {
  readonly selectedLane: RhythmLane;
  readonly score: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly perfect: number;
  readonly good: number;
  readonly misses: number;
  readonly captures: number;
  readonly currentBar: number;
  readonly currentStep: number;
  readonly capturedUntilBar: readonly [number, number, number, number];
  readonly engagedLaneByBar: Readonly<Record<string, RhythmLane>>;
  readonly capturedPhrases: Readonly<Record<string, true>>;
  readonly noteResults: Readonly<Record<string, RhythmJudgement>>;
  readonly lastJudgement: RhythmJudgement | null;
  readonly lastDeltaMs: number | null;
  readonly finished: boolean;
}

export interface RhythmResult {
  readonly state: RhythmState;
  readonly accuracy: number;
  readonly grade: "S" | "A" | "B" | "C" | "D" | "F";
}
