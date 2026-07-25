import type { HexString, LevelManifestV1 } from "@/lib/base/types";

export const PULSE_BPM = 120 as const;
export const PULSE_STEPS_PER_BLOCK = 16 as const;
export const PULSE_SECONDS_PER_BLOCK = 2 as const;
export const PULSE_STEP_SECONDS =
  PULSE_SECONDS_PER_BLOCK / PULSE_STEPS_PER_BLOCK;
export const PULSE_RUN_BLOCKS = 10 as const;
export const PULSE_RUN_SECONDS =
  PULSE_RUN_BLOCKS * PULSE_SECONDS_PER_BLOCK;

export const PULSE_LAYERS = [
  { id: 0, name: "BEAT", color: "#f4eedb" },
  { id: 1, name: "BASS", color: "#b6d81d" },
  { id: 2, name: "SYNTH", color: "#1456f0" },
  { id: 3, name: "FX", color: "#8f62d8" },
] as const;

export type PulseLayer = (typeof PULSE_LAYERS)[number]["id"];
export type PulseRoute = -1 | 0 | 1;
export type PulseFace = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PulseJudgement = "perfect" | "good" | "flow";
export type PulseCueJudgement = "perfect" | "good" | "wrong" | "miss";
export type PulseTutorialStep = 0 | 1 | 2 | 3 | 4;

export interface PulseCue {
  readonly id: string;
  readonly index: number;
  readonly eventIndex: number;
  readonly phraseIndex: number;
  readonly time: number;
  readonly route: PulseRoute;
  readonly lane: 0 | 1 | 2;
  readonly energy: number;
}

export interface PulseEvent {
  readonly id: string;
  readonly index: number;
  readonly time: number;
  readonly blockNumber: string;
  readonly blockHash: HexString;
  readonly explorerUrl: string;
  readonly txCount: number;
  readonly gasRatio: number;
  readonly calldataBytes: number;
  readonly signalHash: HexString;
  readonly signalLayer: PulseLayer;
}

export interface PulseChart {
  readonly version: "base-jam-pulse-v2";
  readonly bpm: typeof PULSE_BPM;
  readonly secondsPerBlock: typeof PULSE_SECONDS_PER_BLOCK;
  readonly durationSeconds: number;
  readonly keyIndex: number;
  readonly ranked: boolean;
  readonly levels: readonly LevelManifestV1[];
  readonly events: readonly PulseEvent[];
  readonly cues: readonly PulseCue[];
}

export interface PulseState {
  readonly score: number;
  readonly streak: number;
  readonly maxStreak: number;
  readonly perfect: number;
  readonly good: number;
  readonly flows: number;
  readonly sealed: number;
  readonly layersUnlocked: number;
  readonly activeFace: PulseFace;
  readonly channelCaptures: readonly [number, number, number, number];
  readonly lastRoutedLayer: PulseLayer | null;
  readonly lastRoute: PulseRoute | null;
  readonly syncBonuses: number;
  readonly currentEvent: number;
  readonly currentCue: number;
  readonly currentStep: number;
  readonly capturedUntilBar: readonly [number, number, number, number];
  readonly eventResults: Readonly<Record<string, PulseJudgement>>;
  readonly cueResults: Readonly<Record<string, PulseCueJudgement>>;
  readonly wrong: number;
  readonly misses: number;
  readonly tutorialStep: PulseTutorialStep;
  readonly lastJudgement: PulseJudgement | null;
  readonly lastDeltaMs: number | null;
  readonly finished: boolean;
}

export interface PulseResult {
  readonly state: PulseState;
  readonly accuracy: number;
  readonly vibe:
    | "CHAIN REACTION"
    | "LOCKED IN"
    | "FOUND THE PULSE"
    | "WARMING UP";
}
