import {
  PULSE_STEP_SECONDS,
  type PulseChart,
  type PulseCue,
  type PulseCueJudgement,
  type PulseFace,
  type PulseJudgement,
  type PulseLayer,
  type PulseResult,
  type PulseRoute,
  type PulseRouteResolution,
  type PulseState,
  type PulseTutorialStep,
} from "./types";

export const PULSE_PERFECT_WINDOW_SECONDS = 0.11;
export const PULSE_GOOD_WINDOW_SECONDS = 0.28;
export const PULSE_GUIDED_WINDOW_SECONDS = 0.48;
export const PULSE_FIRST_WINDOW_SECONDS = 0.56;
export const PULSE_SYNC_BONUS_POINTS = 40;
export const PULSE_TUTORIAL_ROUTES: readonly PulseRoute[] = [0, 0, -1, 1];

const PULSE_FACE_LAYERS = [0, 1, 2, 3, 0, 1, 2, 3] as const satisfies
  readonly PulseLayer[];

function normalizedFace(face: number): PulseFace {
  return (((Math.trunc(face) % 8) + 8) % 8) as PulseFace;
}

export function pulseLayerForFace(face: number): PulseLayer {
  return PULSE_FACE_LAYERS[normalizedFace(face)];
}

export function pulseFaceAfterRoute(
  face: number,
  route: PulseRoute,
): PulseFace {
  return normalizedFace(face + route);
}

function captureTuple(
  values: readonly number[],
): readonly [number, number, number, number] {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
}

function tutorialStepFrom(
  stateOrStep: Pick<PulseState, "tutorialStep"> | PulseTutorialStep,
): PulseTutorialStep {
  return typeof stateOrStep === "number"
    ? stateOrStep
    : stateOrStep.tutorialStep;
}

export function pulseExpectedRoute(
  cue: PulseCue,
  stateOrStep: Pick<PulseState, "tutorialStep"> | PulseTutorialStep,
): PulseRoute {
  const tutorialStep = tutorialStepFrom(stateOrStep);
  return tutorialStep < PULSE_TUTORIAL_ROUTES.length
    ? (PULSE_TUTORIAL_ROUTES[tutorialStep] ?? cue.route)
    : cue.route;
}

export function pulseHitWindowForCue(
  cueOrIndex: PulseCue | number,
  tutorialStep: PulseTutorialStep = 4,
): number {
  const index =
    typeof cueOrIndex === "number" ? cueOrIndex : cueOrIndex.index;
  if (index === 0 && tutorialStep === 0) return PULSE_FIRST_WINDOW_SECONDS;
  return tutorialStep < 4
    ? PULSE_GUIDED_WINDOW_SECONDS
    : PULSE_GOOD_WINDOW_SECONDS;
}

/** @deprecated Render and judge against individual cues instead. */
export function pulseHitWindowForEvent(index: number): number {
  return index === 0
    ? PULSE_FIRST_WINDOW_SECONDS
    : index < 2
      ? PULSE_GUIDED_WINDOW_SECONDS
      : PULSE_GOOD_WINDOW_SECONDS;
}

export function pulseComboMultiplier(combo: number): 1 | 2 | 3 | 4 {
  if (combo >= 20) return 4;
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  return 1;
}

export function createPulseState(): PulseState {
  return {
    score: 0,
    streak: 0,
    maxStreak: 0,
    perfect: 0,
    good: 0,
    flows: 0,
    sealed: 0,
    layersUnlocked: 0,
    activeFace: 0,
    channelCaptures: [0, 0, 0, 0],
    lastRoutedLayer: null,
    lastRoute: null,
    syncBonuses: 0,
    currentEvent: 0,
    currentCue: 0,
    currentStep: 0,
    capturedUntilBar: [0, 0, 0, 0],
    eventResults: {},
    cueResults: {},
    wrong: 0,
    misses: 0,
    tutorialStep: 0,
    lastJudgement: null,
    lastDeltaMs: null,
    finished: false,
  };
}

function cueResultIsHit(result: PulseCueJudgement | undefined): boolean {
  return result === "perfect" || result === "good";
}

function nextOpenCueIndex(
  chart: PulseChart,
  cueResults: PulseState["cueResults"],
): number {
  const next = chart.cues.find((cue) => !cueResults[cue.id]);
  return next?.index ?? Math.max(0, chart.cues.length - 1);
}

function finalizePhraseIfComplete(
  chart: PulseChart,
  state: PulseState,
  eventIndex: number,
): PulseState {
  const event = chart.events[eventIndex];
  if (!event || state.eventResults[event.id]) return state;
  const cues = chart.cues.filter((cue) => cue.eventIndex === eventIndex);
  if (
    cues.length === 0 ||
    cues.some((cue) => state.cueResults[cue.id] === undefined)
  ) {
    return state;
  }

  const hits = cues.filter((cue) =>
    cueResultIsHit(state.cueResults[cue.id]),
  ).length;
  const phraseSucceeded = hits / cues.length >= 0.75;
  const eventResults = { ...state.eventResults };
  const capturedUntilBar = [...state.capturedUntilBar];

  if (!phraseSucceeded) {
    eventResults[event.id] = "flow";
    capturedUntilBar[event.signalLayer] = Math.min(
      capturedUntilBar[event.signalLayer] ?? 0,
      event.index,
    );
    return {
      ...state,
      flows: state.flows + 1,
      capturedUntilBar: captureTuple(capturedUntilBar),
      eventResults,
    };
  }

  const judgement: PulseJudgement = cues.every(
    (cue) => state.cueResults[cue.id] === "perfect",
  )
    ? "perfect"
    : "good";
  const channelCaptures = [...state.channelCaptures];
  channelCaptures[event.signalLayer] += 1;
  capturedUntilBar[event.signalLayer] = Math.max(
    capturedUntilBar[event.signalLayer] ?? 0,
    event.index + 3,
  );
  eventResults[event.id] = judgement;

  return {
    ...state,
    sealed: state.sealed + 1,
    channelCaptures: captureTuple(channelCaptures),
    capturedUntilBar: captureTuple(capturedUntilBar),
    layersUnlocked: channelCaptures.filter((captures) => captures > 0).length,
    eventResults,
  };
}

function withCueResult(
  chart: PulseChart,
  state: PulseState,
  cue: PulseCue,
  result: PulseCueJudgement,
): PulseState {
  const cueResults = { ...state.cueResults, [cue.id]: result };
  const next = {
    ...state,
    cueResults,
    currentCue: nextOpenCueIndex(chart, cueResults),
  };
  return finalizePhraseIfComplete(chart, next, cue.eventIndex);
}

export function resolvePulseRoute(
  chart: PulseChart,
  state: PulseState,
  songTime: number,
  route: PulseRoute,
): PulseRouteResolution {
  const previousFace = state.activeFace;
  if (state.finished) {
    return {
      state,
      route,
      previousFace,
      activeFace: state.activeFace,
      songTimeSeconds: songTime,
      cueId: null,
      cueIndex: null,
      expectedRoute: null,
      outcome: "ignored",
      deltaMs: null,
      routedLayer: null,
      phraseResult: null,
    };
  }

  const activeFace = pulseFaceAfterRoute(state.activeFace, route);
  const openCue = chart.cues.find((cue) => !state.cueResults[cue.id]);
  const openDelta = openCue ? songTime - openCue.time : 0;
  const expectedRoute = openCue ? pulseExpectedRoute(openCue, state) : null;
  // Only the one command visibly presented to the player can resolve. Guided
  // windows overlap by design; choosing the mathematically nearest later cue
  // would make a correct-looking input skip the target still on screen.
  const candidate =
    openCue &&
    Math.abs(openDelta) <=
      pulseHitWindowForCue(openCue, state.tutorialStep)
      ? { cue: openCue, delta: openDelta }
      : undefined;

  if (!candidate) {
    const nextState = {
      ...state,
      activeFace,
      lastRoute: route,
      lastRoutedLayer: null,
      lastJudgement: null,
      lastDeltaMs: null,
    };
    return {
      state: nextState,
      route,
      previousFace,
      activeFace,
      songTimeSeconds: songTime,
      cueId: openCue?.id ?? null,
      cueIndex: openCue?.index ?? null,
      expectedRoute,
      outcome: !openCue ? "ignored" : openDelta < 0 ? "early" : "late",
      deltaMs: openCue ? Math.round(openDelta * 1_000) : null,
      routedLayer: null,
      phraseResult: null,
    };
  }

  const candidateExpectedRoute = pulseExpectedRoute(candidate.cue, state);
  if (route !== candidateExpectedRoute) {
    const nextState = withCueResult(
      chart,
      {
        ...state,
        activeFace,
        streak: 0,
        wrong: state.wrong + 1,
        lastRoute: route,
        lastRoutedLayer: null,
        lastJudgement: null,
        lastDeltaMs: Math.round(candidate.delta * 1_000),
      },
      candidate.cue,
      "wrong",
    );
    const event = chart.events[candidate.cue.eventIndex];
    return {
      state: nextState,
      route,
      previousFace,
      activeFace,
      songTimeSeconds: songTime,
      cueId: candidate.cue.id,
      cueIndex: candidate.cue.index,
      expectedRoute: candidateExpectedRoute,
      outcome: "wrong",
      deltaMs: Math.round(candidate.delta * 1_000),
      routedLayer: null,
      phraseResult: event ? (nextState.eventResults[event.id] ?? null) : null,
    };
  }

  const judgement: Extract<PulseCueJudgement, "perfect" | "good"> =
    Math.abs(candidate.delta) <= PULSE_PERFECT_WINDOW_SECONDS
      ? "perfect"
      : "good";
  const streak = state.streak + 1;
  const multiplier = pulseComboMultiplier(streak);
  const routedLayer = pulseLayerForFace(activeFace);
  const isSyncBonus =
    routedLayer === chart.events[candidate.cue.eventIndex]?.signalLayer;
  const score = (judgement === "perfect" ? 100 : 70) * multiplier;
  const tutorialStep = Math.min(
    4,
    state.tutorialStep + 1,
  ) as PulseTutorialStep;

  const nextState = withCueResult(
    chart,
    {
      ...state,
      activeFace,
      score:
        state.score +
        score +
        (isSyncBonus ? PULSE_SYNC_BONUS_POINTS : 0),
      streak,
      maxStreak: Math.max(state.maxStreak, streak),
      perfect: state.perfect + (judgement === "perfect" ? 1 : 0),
      good: state.good + (judgement === "good" ? 1 : 0),
      lastRoutedLayer: routedLayer,
      lastRoute: route,
      syncBonuses: state.syncBonuses + (isSyncBonus ? 1 : 0),
      tutorialStep,
      lastJudgement: judgement,
      lastDeltaMs: Math.round(candidate.delta * 1_000),
    },
    candidate.cue,
    judgement,
  );
  const event = chart.events[candidate.cue.eventIndex];
  return {
    state: nextState,
    route,
    previousFace,
    activeFace,
    songTimeSeconds: songTime,
    cueId: candidate.cue.id,
    cueIndex: candidate.cue.index,
    expectedRoute: candidateExpectedRoute,
    outcome: judgement,
    deltaMs: Math.round(candidate.delta * 1_000),
    routedLayer,
    phraseResult: event ? (nextState.eventResults[event.id] ?? null) : null,
  };
}

export function judgePulseRoute(
  chart: PulseChart,
  state: PulseState,
  songTime: number,
  route: PulseRoute,
): PulseState {
  return resolvePulseRoute(chart, state, songTime, route).state;
}

export function judgePulseTap(
  chart: PulseChart,
  state: PulseState,
  songTime: number,
): PulseState {
  return judgePulseRoute(chart, state, songTime, 0);
}

export function advancePulseState(
  chart: PulseChart,
  state: PulseState,
  songTime: number,
): PulseState {
  if (state.finished) return state;
  const boundedTime = Math.max(0, songTime);
  const currentEvent = Math.min(
    chart.events.length - 1,
    Math.floor(boundedTime / chart.secondsPerBlock),
  );
  const currentStep = Math.floor(songTime / PULSE_STEP_SECONDS);
  let next = state;
  const expired = chart.cues.filter(
    (cue) =>
      !next.cueResults[cue.id] &&
      cue.time + pulseHitWindowForCue(cue, next.tutorialStep) < boundedTime,
  );

  for (const cue of expired) {
    next = withCueResult(
      chart,
      {
        ...next,
        streak: 0,
        misses: next.misses + 1,
        lastJudgement: null,
        lastDeltaMs: null,
      },
      cue,
      "miss",
    );
  }

  const currentCue = nextOpenCueIndex(chart, next.cueResults);
  if (
    expired.length === 0 &&
    currentEvent === state.currentEvent &&
    currentCue === state.currentCue &&
    currentStep === state.currentStep
  ) {
    return state;
  }

  return {
    ...next,
    currentEvent,
    currentCue,
    currentStep,
  };
}

export function finishPulseState(
  chart: PulseChart,
  state: PulseState,
): PulseState {
  if (state.finished) return state;
  let next = state;
  for (const cue of chart.cues) {
    if (next.cueResults[cue.id]) continue;
    next = withCueResult(
      chart,
      {
        ...next,
        streak: 0,
        misses: next.misses + 1,
        lastJudgement: null,
        lastDeltaMs: null,
      },
      cue,
      "miss",
    );
  }
  return { ...next, finished: true };
}

export function pulseAccuracy(state: PulseState): number {
  const judged = state.perfect + state.good + state.wrong + state.misses;
  if (judged === 0) return 0;
  return Math.round(
    ((state.perfect + state.good * 0.72) / judged) * 100,
  );
}

export function pulseResult(state: PulseState): PulseResult {
  const accuracy = pulseAccuracy(state);
  const vibe =
    accuracy >= 90
      ? "CHAIN REACTION"
      : accuracy >= 70
        ? "LOCKED IN"
        : accuracy >= 40
          ? "FOUND THE PULSE"
          : "WARMING UP";
  return { state, accuracy, vibe };
}
