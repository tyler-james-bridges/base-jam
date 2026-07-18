import {
  RHYTHM_STEP_SECONDS,
  type RhythmChart,
  type RhythmColumn,
  type RhythmJudgement,
  type RhythmLane,
  type RhythmResult,
  type RhythmState,
} from "./types";

export const PERFECT_WINDOW_SECONDS = 0.072;
export const GOOD_WINDOW_SECONDS = 0.17;
export const FOCUS_PERFECT_WINDOW_SECONDS = 0.105;
export const FOCUS_GOOD_WINDOW_SECONDS = 0.24;

export interface RhythmTimingOptions {
  readonly goodWindowSeconds?: number;
  readonly perfectWindowSeconds?: number;
  readonly punishGhostTaps?: boolean;
}

function activeCaptureTuple(
  values: readonly number[],
): readonly [number, number, number, number] {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
}

export function createRhythmState(): RhythmState {
  return {
    selectedLane: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    good: 0,
    misses: 0,
    captures: 0,
    currentBar: 0,
    currentStep: 0,
    capturedUntilBar: [0, 0, 0, 0],
    engagedLaneByBar: { 0: 0 },
    capturedPhrases: {},
    noteResults: {},
    lastJudgement: null,
    lastDeltaMs: null,
    finished: false,
  };
}

export function selectRhythmLane(
  state: RhythmState,
  lane: RhythmLane,
): RhythmState {
  if (state.finished || lane === state.selectedLane) return state;
  return {
    ...state,
    selectedLane: lane,
    engagedLaneByBar: {
      ...state.engagedLaneByBar,
      [state.currentBar]: lane,
    },
  };
}

function scoreFor(judgement: RhythmJudgement, combo: number): number {
  if (judgement === "miss") return 0;
  const base = judgement === "perfect" ? 100 : 60;
  const multiplier = Math.min(2, 1 + Math.floor(combo / 8) * 0.25);
  return Math.round(base * multiplier);
}

function withCapture(
  chart: RhythmChart,
  state: RhythmState,
  bar: number,
  lane: RhythmLane,
): RhythmState {
  const phraseKey = `${bar}:${lane}`;
  if (state.capturedPhrases[phraseKey]) return state;
  const phrase = chart.notes.filter(
    (note) => note.bar === bar && note.lane === lane,
  );
  if (
    phrase.length === 0 ||
    !phrase.every((note) => {
      const result = state.noteResults[note.id];
      return result === "perfect" || result === "good";
    })
  ) {
    return state;
  }

  const capturedUntilBar = [...state.capturedUntilBar];
  capturedUntilBar[lane] = Math.max(capturedUntilBar[lane], bar + 4);
  return {
    ...state,
    score: state.score + 500,
    captures: state.captures + 1,
    capturedUntilBar: activeCaptureTuple(capturedUntilBar),
    capturedPhrases: {
      ...state.capturedPhrases,
      [phraseKey]: true,
    },
  };
}

export function judgeRhythmHit(
  chart: RhythmChart,
  state: RhythmState,
  column: RhythmColumn,
  songTime: number,
  options: RhythmTimingOptions = {},
): RhythmState {
  if (state.finished) return state;
  const goodWindow = options.goodWindowSeconds ?? GOOD_WINDOW_SECONDS;
  const perfectWindow =
    options.perfectWindowSeconds ?? PERFECT_WINDOW_SECONDS;
  const candidates = chart.notes
    .filter(
      (note) =>
        note.lane === state.selectedLane &&
        note.column === column &&
        !state.noteResults[note.id],
    )
    .map((note) => ({ note, delta: songTime - note.time }))
    .filter(({ delta }) => Math.abs(delta) <= goodWindow)
    .sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta));
  const candidate = candidates[0];

  if (!candidate) {
    if (options.punishGhostTaps === false) {
      return {
        ...state,
        lastJudgement: null,
        lastDeltaMs: null,
      };
    }
    return {
      ...state,
      combo: 0,
      misses: state.misses + 1,
      lastJudgement: "miss",
      lastDeltaMs: null,
    };
  }

  const judgement: RhythmJudgement =
    Math.abs(candidate.delta) <= perfectWindow ? "perfect" : "good";
  const combo = state.combo + 1;
  let next: RhythmState = {
    ...state,
    score: state.score + scoreFor(judgement, combo),
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    perfect: state.perfect + (judgement === "perfect" ? 1 : 0),
    good: state.good + (judgement === "good" ? 1 : 0),
    noteResults: {
      ...state.noteResults,
      [candidate.note.id]: judgement,
    },
    engagedLaneByBar: {
      ...state.engagedLaneByBar,
      [candidate.note.bar]: state.selectedLane,
    },
    lastJudgement: judgement,
    lastDeltaMs: Math.round(candidate.delta * 1_000),
  };
  next = withCapture(
    chart,
    next,
    candidate.note.bar,
    candidate.note.lane,
  );
  return next;
}

export function advanceRhythmState(
  chart: RhythmChart,
  state: RhythmState,
  songTime: number,
  goodWindowSeconds = GOOD_WINDOW_SECONDS,
): RhythmState {
  if (state.finished) return state;
  const boundedTime = Math.max(0, songTime);
  const currentStep = Math.floor(boundedTime / RHYTHM_STEP_SECONDS);
  const currentBar = Math.min(
    chart.bars.length - 1,
    Math.floor(boundedTime / chart.secondsPerBar),
  );
  let next: RhythmState = state;

  if (currentBar !== state.currentBar || currentStep !== state.currentStep) {
    next = {
      ...state,
      currentBar,
      currentStep,
      engagedLaneByBar: {
        ...state.engagedLaneByBar,
        ...(state.engagedLaneByBar[currentBar] === undefined
          ? { [currentBar]: state.selectedLane }
          : {}),
      },
    };
  }

  const expired = chart.notes.filter((note) => {
    const engagedLane = next.engagedLaneByBar[note.bar];
    return (
      !next.noteResults[note.id] &&
      engagedLane === note.lane &&
      note.time + goodWindowSeconds < boundedTime
    );
  });
  if (expired.length > 0) {
    const noteResults = { ...next.noteResults };
    expired.forEach((note) => {
      noteResults[note.id] = "miss";
    });
    next = {
      ...next,
      combo: 0,
      misses: next.misses + expired.length,
      noteResults,
      lastJudgement: "miss",
      lastDeltaMs: null,
    };
  }

  return next;
}

export function finishRhythmState(state: RhythmState): RhythmState {
  return state.finished ? state : { ...state, finished: true };
}

export function rhythmAccuracy(state: RhythmState): number {
  const judged = state.perfect + state.good + state.misses;
  if (judged === 0) return 0;
  return Math.round(((state.perfect + state.good * 0.65) / judged) * 100);
}

export function rhythmResult(state: RhythmState): RhythmResult {
  const accuracy = rhythmAccuracy(state);
  const grade =
    accuracy >= 94 && state.captures >= 4
      ? "S"
      : accuracy >= 85
        ? "A"
        : accuracy >= 72
          ? "B"
          : accuracy >= 58
            ? "C"
            : accuracy >= 40
              ? "D"
              : "F";
  return { state, accuracy, grade };
}
