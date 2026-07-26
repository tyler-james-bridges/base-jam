import { PulseAudioEngine } from "@/audio/pulseAudio";
import {
  advancePulseState,
  createPulseState,
  finishPulseState,
  pulseExpectedRoute,
  pulseFaceAfterRoute,
  resolvePulseRoute,
} from "./state";
import {
  PULSE_LAYERS,
  type PulseChart,
  type PulseCue,
  type PulsePauseReason,
  type PulseRoute,
  type PulseRouteResolution,
  type PulseRuntimeDecision,
  type PulseRuntimeFeedback,
  type PulseRuntimeSnapshot,
  type PulseState,
  type PulseTutorialStep,
} from "./types";

export const BASE_JAM_PULSE_PRE_ROLL_SECONDS = 1.8;
export const BASE_JAM_PULSE_ROUTE_SETTLE_MS = 150;

export interface BaseJamPulseGameInput {
  readonly chart: PulseChart;
  readonly audioContext: AudioContext | null;
}

export interface BaseJamPulseBridge {
  readonly onComplete: (state: PulseState, image: string | null) => void;
  readonly onFeedback: (message: string) => void;
  readonly onMutedChange: (muted: boolean) => void;
  readonly onReady: () => void;
  readonly onRuntimeChange?: (snapshot: PulseRuntimeSnapshot) => void;
  readonly onStateChange: (state: PulseState) => void;
}

export interface BaseJamPulseController {
  readonly capture: () => string | null;
  readonly destroy: () => void;
  readonly finish: () => void;
  readonly pause: (reason?: Exclude<PulsePauseReason, null>) => boolean;
  readonly resume: () => boolean;
  readonly route: (
    direction: PulseRoute,
    pointerStartedAt?: number,
  ) => void;
  readonly setFocused: (
    focused: boolean,
    reason?: Extract<PulsePauseReason, "focus" | "visibility">,
  ) => void;
  readonly setReducedMotion: (reducedMotion: boolean) => void;
  readonly snapshot: () => PulseRuntimeSnapshot;
  readonly tap: () => void;
  readonly toggleMuted: () => void;
}

export interface PulseControllerScheduler {
  readonly now: () => number;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export interface PulseHapticCapability {
  readonly coarsePointer: boolean;
  readonly maxTouchPoints: number;
  readonly vibrateSupported: boolean;
}

export function canUsePulseHaptics(
  reducedMotion: boolean,
  muted: boolean,
  capability: PulseHapticCapability,
): boolean {
  return (
    !reducedMotion &&
    !muted &&
    capability.vibrateSupported &&
    (capability.coarsePointer || capability.maxTouchPoints > 0)
  );
}

function browserScheduler(): PulseControllerScheduler {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
}

function newestResolvedCue(
  chart: PulseChart,
  previous: PulseState,
  next: PulseState,
  result: "miss" | "perfect" | "good" | "wrong",
): PulseCue | undefined {
  return chart.cues.find(
    (cue) =>
      previous.cueResults[cue.id] === undefined &&
      next.cueResults[cue.id] === result,
  );
}

function newlyCompletedEvent(
  chart: PulseChart,
  previous: PulseState,
  next: PulseState,
) {
  return chart.events.find(
    (event) =>
      previous.eventResults[event.id] === undefined &&
      next.eventResults[event.id] !== undefined,
  );
}

function routeLabel(route: PulseRoute | null) {
  return route === null ? "" : route === 0 ? "TAP" : route < 0 ? "LEFT" : "RIGHT";
}

class PulseController implements BaseJamPulseController {
  private readonly input: BaseJamPulseGameInput;
  private readonly bridge: BaseJamPulseBridge;
  private readonly scheduler: PulseControllerScheduler;
  private readonly audio: PulseAudioEngine;
  private state: PulseState = createPulseState();
  private songTime = -BASE_JAM_PULSE_PRE_ROLL_SECONDS;
  private started = false;
  private completed = false;
  private destroyed = false;
  private focused = true;
  private reducedMotion = false;
  private pauseReason: PulsePauseReason = null;
  private frameHandle: number | null = null;
  private completionHandle: number | null = null;
  private feedbackSequence = 0;
  private lastFeedback: PulseRuntimeFeedback | null = null;

  constructor(
    input: BaseJamPulseGameInput,
    bridge: BaseJamPulseBridge,
    scheduler: PulseControllerScheduler,
  ) {
    this.input = input;
    this.bridge = bridge;
    this.scheduler = scheduler;
    this.audio = new PulseAudioEngine(
      input.audioContext,
      input.chart,
      () => this.state,
    );
    this.state = advancePulseState(input.chart, this.state, this.songTime);
    this.bridge.onStateChange(this.state);
    this.bridge.onReady();
    this.emitRuntime();
  }

  capture = () => null;

  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelFrame();
    if (this.completionHandle !== null) {
      this.scheduler.clearTimeout(this.completionHandle);
      this.completionHandle = null;
    }
    this.audio.stop();
  };

  finish = () => {
    if (this.completed || this.destroyed) return;
    this.completed = true;
    this.cancelFrame();
    this.songTime = Math.min(
      this.input.chart.durationSeconds,
      Math.max(0, this.liveSongTime()),
    );
    this.state = finishPulseState(this.input.chart, this.state);
    this.audio.stop();
    this.pauseReason = null;
    this.bridge.onStateChange(this.state);
    this.emitRuntime();
    this.completionHandle = this.scheduler.setTimeout(() => {
      this.completionHandle = null;
      if (!this.destroyed) this.bridge.onComplete(this.state, null);
    }, 260);
  };

  pause = (
    reason: Exclude<PulsePauseReason, null> = "manual",
  ): boolean => {
    if (
      this.destroyed ||
      this.completed ||
      !this.started ||
      this.pauseReason !== null
    ) {
      return false;
    }
    this.songTime = this.liveSongTime();
    this.pauseReason = reason;
    this.audio.pause();
    this.cancelFrame();
    this.emitRuntime();
    return true;
  };

  resume = (): boolean => {
    if (
      this.destroyed ||
      this.completed ||
      !this.started ||
      this.pauseReason === null ||
      !this.focused
    ) {
      return false;
    }
    this.pauseReason = null;
    this.audio.resume();
    this.songTime = this.liveSongTime();
    this.scheduleFrame();
    this.emitRuntime();
    return true;
  };

  route = (direction: PulseRoute, pointerStartedAt?: number) => {
    if (
      this.destroyed ||
      this.completed ||
      !this.focused ||
      this.pauseReason !== null
    ) {
      return;
    }
    if (!this.started) {
      if (direction !== 0) {
        this.bridge.onFeedback("TAP TO START");
        return;
      }
      this.started = true;
      this.audio.start(BASE_JAM_PULSE_PRE_ROLL_SECONDS);
      this.songTime = -BASE_JAM_PULSE_PRE_ROLL_SECONDS;
      this.state = advancePulseState(
        this.input.chart,
        this.state,
        this.songTime,
      );
      this.bridge.onFeedback("Signal armed · follow the first block");
      this.bridge.onStateChange(this.state);
      this.vibrate(8);
      this.scheduleFrame();
      this.emitRuntime();
      return;
    }

    const inputSongTime = this.songTimeAtInput(pointerStartedAt);
    const beforeAdvance = this.state;
    const advanced = advancePulseState(
      this.input.chart,
      beforeAdvance,
      inputSongTime,
    );
    this.captureNewPhrase(beforeAdvance, advanced);
    const resolution = resolvePulseRoute(
      this.input.chart,
      advanced,
      inputSongTime,
      direction,
    );
    this.state = resolution.state;
    this.captureNewPhrase(advanced, this.state);
    this.songTime = inputSongTime;
    const receivedAtPerformanceMs = this.scheduler.now();
    const inputAtPerformanceMs =
      pointerStartedAt !== undefined && Number.isFinite(pointerStartedAt)
        ? Math.min(pointerStartedAt, receivedAtPerformanceMs)
        : receivedAtPerformanceMs;
    this.recordResolution(
      resolution,
      inputAtPerformanceMs,
      receivedAtPerformanceMs,
    );
    this.respondToResolution(resolution);
    this.bridge.onStateChange(this.state);
    this.emitRuntime();
  };

  setFocused = (
    focused: boolean,
    reason: Extract<PulsePauseReason, "focus" | "visibility"> = "focus",
  ) => {
    if (this.destroyed || this.focused === focused) return;
    this.focused = focused;
    if (!focused) {
      if (!this.pause(reason)) this.emitRuntime();
      return;
    }
    if (this.pauseReason === "focus" || this.pauseReason === "visibility") {
      this.resume();
    } else {
      this.emitRuntime();
    }
  };

  setReducedMotion = (reducedMotion: boolean) => {
    if (this.reducedMotion === reducedMotion) return;
    this.reducedMotion = reducedMotion;
    this.emitRuntime();
  };

  snapshot = (): PulseRuntimeSnapshot => {
    const songTimeSeconds =
      this.started && this.pauseReason === null && !this.completed
        ? this.liveSongTime()
        : this.songTime;
    const decisions = this.nextDecisions(songTimeSeconds);
    const currentDecision = decisions[0];
    const phase = this.completed
      ? "finished"
      : this.pauseReason !== null
        ? "paused"
        : !this.started
          ? "idle"
          : songTimeSeconds < 0
            ? "preroll"
            : "playing";
    return {
      state: this.state,
      songTimeSeconds,
      phase,
      pauseReason: this.pauseReason,
      focused: this.focused,
      reducedMotion: this.reducedMotion,
      muted: this.audio.isMuted(),
      currentCueId: currentDecision?.cueId ?? null,
      currentCueIndex: currentDecision?.cueIndex ?? null,
      cueDeltaSeconds: currentDecision?.deltaSeconds ?? null,
      expectedRoute: currentDecision?.expectedRoute ?? null,
      targetFace: currentDecision?.targetFace ?? this.state.activeFace,
      decisions,
      lastFeedback: this.lastFeedback,
    };
  };

  tap = () => {
    this.route(0);
  };

  toggleMuted = () => {
    const muted = this.audio.toggleMuted();
    this.bridge.onMutedChange(muted);
    this.bridge.onFeedback(muted ? "Audio muted" : "Audio live");
    this.emitRuntime();
  };

  private tick = () => {
    this.frameHandle = null;
    if (
      this.destroyed ||
      this.completed ||
      !this.started ||
      this.pauseReason !== null
    ) {
      return;
    }

    this.audio.update();
    this.songTime = this.liveSongTime();
    const previous = this.state;
    const next = advancePulseState(
      this.input.chart,
      previous,
      this.songTime,
    );
    this.state = next;
    if (next !== previous) {
      this.captureNewPhrase(previous, next);
      const missedCue = newestResolvedCue(
        this.input.chart,
        previous,
        next,
        "miss",
      );
      if (missedCue) this.recordAutomaticMiss(previous, next, missedCue);
      this.bridge.onStateChange(next);
      this.emitRuntime();
    }
    if (this.songTime >= this.input.chart.durationSeconds) {
      this.finish();
      return;
    }
    this.scheduleFrame();
  };

  private scheduleFrame() {
    if (
      this.frameHandle !== null ||
      this.destroyed ||
      this.completed ||
      !this.started ||
      this.pauseReason !== null
    ) {
      return;
    }
    this.frameHandle = this.scheduler.requestFrame(this.tick);
  }

  private cancelFrame() {
    if (this.frameHandle === null) return;
    this.scheduler.cancelFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private liveSongTime() {
    return this.audio.songTime();
  }

  private songTimeAtInput(pointerStartedAt?: number) {
    const liveSongTime = Math.max(0, this.liveSongTime());
    if (pointerStartedAt === undefined || !Number.isFinite(pointerStartedAt)) {
      return liveSongTime;
    }
    const gestureDurationMs = this.scheduler.now() - pointerStartedAt;
    if (gestureDurationMs < 0 || gestureDurationMs > 1_500) {
      return liveSongTime;
    }
    return Math.max(0, liveSongTime - gestureDurationMs / 1_000);
  }

  private captureNewPhrase(previous: PulseState, next: PulseState) {
    const event = newlyCompletedEvent(this.input.chart, previous, next);
    if (event) {
      const judgement = next.eventResults[event.id];
      if (judgement === "perfect" || judgement === "good") {
        this.audio.capture(event.signalLayer, judgement);
      }
    }
  }

  private nextDecisions(
    songTimeSeconds: number,
  ): readonly PulseRuntimeDecision[] {
    const decisions: PulseRuntimeDecision[] = [];
    let targetFace = this.state.activeFace;
    let tutorialStep = this.state.tutorialStep;
    for (const cue of this.input.chart.cues) {
      if (this.state.cueResults[cue.id] !== undefined) continue;
      const expectedRoute = pulseExpectedRoute(cue, tutorialStep);
      targetFace = pulseFaceAfterRoute(targetFace, expectedRoute);
      decisions.push({
        cueId: cue.id,
        cueIndex: cue.index,
        timeSeconds: cue.time,
        deltaSeconds: cue.time - songTimeSeconds,
        expectedRoute,
        targetFace,
        lane: cue.lane,
        energy: cue.energy,
      });
      tutorialStep = Math.min(4, tutorialStep + 1) as PulseTutorialStep;
      if (decisions.length === 3) break;
    }
    return decisions;
  }

  private recordResolution(
    resolution: PulseRouteResolution,
    inputAtPerformanceMs: number,
    receivedAtPerformanceMs: number,
  ) {
    this.feedbackSequence += 1;
    this.lastFeedback = {
      sequence: this.feedbackSequence,
      inputAtPerformanceMs,
      receivedAtPerformanceMs,
      publishedAtPerformanceMs: this.scheduler.now(),
      settleDurationMs: BASE_JAM_PULSE_ROUTE_SETTLE_MS,
      route: resolution.route,
      previousFace: resolution.previousFace,
      activeFace: resolution.activeFace,
      songTimeSeconds: resolution.songTimeSeconds,
      cueId: resolution.cueId,
      cueIndex: resolution.cueIndex,
      expectedRoute: resolution.expectedRoute,
      outcome: resolution.outcome,
      deltaMs: resolution.deltaMs,
      routedLayer: resolution.routedLayer,
      phraseResult: resolution.phraseResult,
    };
  }

  private recordAutomaticMiss(
    previous: PulseState,
    next: PulseState,
    cue: PulseCue,
  ) {
    const expectedRoute = pulseExpectedRoute(cue, previous);
    const event = this.input.chart.events[cue.eventIndex];
    this.feedbackSequence += 1;
    const now = this.scheduler.now();
    this.lastFeedback = {
      sequence: this.feedbackSequence,
      inputAtPerformanceMs: now,
      receivedAtPerformanceMs: now,
      publishedAtPerformanceMs: now,
      settleDurationMs: BASE_JAM_PULSE_ROUTE_SETTLE_MS,
      route: null,
      previousFace: previous.activeFace,
      activeFace: next.activeFace,
      songTimeSeconds: this.songTime,
      cueId: cue.id,
      cueIndex: cue.index,
      expectedRoute,
      outcome: "miss",
      deltaMs: Math.round((this.songTime - cue.time) * 1_000),
      routedLayer: null,
      phraseResult: event ? (next.eventResults[event.id] ?? null) : null,
    };
    this.audio.miss("late");
    this.vibrate([5, 18, 5]);
    this.bridge.onFeedback(
      event && next.eventResults[event.id] === "flow"
        ? `LATE · ${PULSE_LAYERS[event.signalLayer].name} CHANNEL DROPPED`
        : "LATE",
    );
  }

  private respondToResolution(resolution: PulseRouteResolution) {
    const resolvedCue =
      resolution.cueId === null
        ? undefined
        : this.input.chart.cues.find(
            (candidate) => candidate.id === resolution.cueId,
          );
    const phraseLayer =
      resolvedCue === undefined
        ? null
        : (this.input.chart.events[
            resolvedCue.eventIndex
          ]?.signalLayer ?? null);
    const phraseLabel =
      resolution.phraseResult === "perfect" ||
      resolution.phraseResult === "good"
        ? phraseLayer === null
          ? "PHRASE SEALED"
          : `PHRASE SEALED · ${PULSE_LAYERS[phraseLayer].name} LIVE`
        : resolution.phraseResult === "flow" && phraseLayer !== null
          ? `${PULSE_LAYERS[phraseLayer].name} CHANNEL DROPPED`
          : null;
    if (
      resolution.route !== 0 &&
      resolution.previousFace !== resolution.activeFace
    ) {
      this.audio.routeSwitch(
        resolution.route,
        resolution.outcome === "perfect" ||
          resolution.outcome === "good",
      );
    }

    if (resolution.outcome === "perfect" || resolution.outcome === "good") {
      if (resolvedCue && resolution.routedLayer !== null) {
        this.audio.hit(
          resolution.routedLayer,
          resolvedCue.lane,
          resolution.outcome,
        );
      }
      const label = resolution.outcome === "perfect" ? "PERFECT" : "GOOD";
      this.vibrate(resolution.outcome === "perfect" ? [12, 22, 12] : 10);
      this.bridge.onFeedback(phraseLabel ? `${label} · ${phraseLabel}` : label);
      return;
    }

    if (resolution.outcome === "wrong") {
      this.audio.miss("wrong");
      this.vibrate([7, 18, 7]);
      this.bridge.onFeedback(
        phraseLabel
          ? `WRONG · ${phraseLabel}`
          : `WRONG · ${routeLabel(resolution.expectedRoute)}`,
      );
      return;
    }

    if (resolution.outcome === "late") {
      this.audio.miss("late");
      this.vibrate([5, 18, 5]);
      this.bridge.onFeedback("LATE");
      return;
    }

    if (resolution.outcome === "early") {
      this.vibrate(5);
      this.bridge.onFeedback("EARLY");
    }
  }

  private vibrate(pattern: number | number[]) {
    if (typeof navigator === "undefined") return;
    const coarsePointer =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (
      !canUsePulseHaptics(
        this.reducedMotion,
        this.audio.isMuted(),
        {
          coarsePointer,
          maxTouchPoints: navigator.maxTouchPoints,
          vibrateSupported: typeof navigator.vibrate === "function",
        },
      )
    ) {
      return;
    }
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some embedded browsers expose vibrate but reject the call at runtime.
    }
  }

  private emitRuntime() {
    this.bridge.onRuntimeChange?.(this.snapshot());
  }
}

export function createBaseJamPulseController(
  input: BaseJamPulseGameInput,
  bridge: BaseJamPulseBridge,
  scheduler: PulseControllerScheduler = browserScheduler(),
): BaseJamPulseController {
  return new PulseController(input, bridge, scheduler);
}
