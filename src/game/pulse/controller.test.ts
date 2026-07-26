import { afterEach, describe, expect, it, vi } from "vitest";
import { PulseAudioEngine } from "@/audio/pulseAudio";
import { createPracticeManifest } from "@/lib/base/manifest";
import { createPulseChart } from "./chart";
import {
  BASE_JAM_PULSE_ROUTE_SETTLE_MS,
  canUsePulseHaptics,
  createBaseJamPulseController,
  type BaseJamPulseBridge,
  type PulseControllerScheduler,
} from "./controller";
import type { PulseRuntimeSnapshot, PulseState } from "./types";

interface TestClock {
  readonly scheduler: PulseControllerScheduler;
  readonly setNow: (milliseconds: number) => void;
}

function createTestClock(): TestClock {
  let now = 0;
  let nextHandle = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();

  return {
    scheduler: {
      now: () => now,
      requestFrame: (callback) => {
        const handle = nextHandle++;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => {
        frames.delete(handle);
      },
      setTimeout: (callback) => {
        const handle = nextHandle++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => {
        timers.delete(handle);
      },
    },
    setNow: (milliseconds) => {
      now = milliseconds;
    },
  };
}

function createBridge() {
  const states: PulseState[] = [];
  const runtime: PulseRuntimeSnapshot[] = [];
  const bridge: BaseJamPulseBridge = {
    onComplete: vi.fn(),
    onFeedback: vi.fn(),
    onMutedChange: vi.fn(),
    onReady: vi.fn(),
    onRuntimeChange: (snapshot) => runtime.push(snapshot),
    onStateChange: (state) => states.push(state),
  };
  return { bridge, runtime, states };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pulse haptic policy", () => {
  const phone = {
    coarsePointer: true,
    maxTouchPoints: 5,
    vibrateSupported: true,
  };

  it("allows supported phone haptics while sound is live", () => {
    expect(canUsePulseHaptics(false, false, phone)).toBe(true);
  });

  it("respects mute, reduced motion, and unsupported desktop browsers", () => {
    expect(canUsePulseHaptics(false, true, phone)).toBe(false);
    expect(canUsePulseHaptics(true, false, phone)).toBe(false);
    expect(
      canUsePulseHaptics(false, false, {
        coarsePointer: false,
        maxTouchPoints: 0,
        vibrateSupported: true,
      }),
    ).toBe(false);
    expect(
      canUsePulseHaptics(false, false, {
        coarsePointer: true,
        maxTouchPoints: 5,
        vibrateSupported: false,
      }),
    ).toBe(false);
  });
});

describe("renderer-free pulse controller", () => {
  const chart = createPulseChart(
    [createPracticeManifest({ reason: "controller test fixture" })],
    10,
  );

  it("exposes exact time plus the next three deterministic decisions", () => {
    const clock = createTestClock();
    vi.spyOn(performance, "now").mockImplementation(
      () => clock.scheduler.now(),
    );
    const { bridge } = createBridge();
    const controller = createBaseJamPulseController(
      { audioContext: null, chart },
      bridge,
      clock.scheduler,
    );

    expect(bridge.onReady).toHaveBeenCalledOnce();
    expect(controller.snapshot().phase).toBe("idle");
    expect(
      controller.snapshot().decisions.map((decision) => ({
        route: decision.expectedRoute,
        target: decision.targetFace,
      })),
    ).toEqual([
      { route: 0, target: 0 },
      { route: 0, target: 0 },
      { route: -1, target: 7 },
    ]);

    // GameView queues this immediately after onReady, preserving one CTA.
    controller.tap();
    expect(controller.snapshot().phase).toBe("preroll");
    expect(controller.snapshot().songTimeSeconds).toBe(-1.8);

    clock.setNow(2_337);
    expect(controller.snapshot().songTimeSeconds).toBeCloseTo(0.537, 6);
    // Runtime time stays continuous even before the next state/React update.
    expect(controller.snapshot().state.currentStep).toBe(-15);
    controller.destroy();
  });

  it("publishes route, judgement, score, and timing synchronously", () => {
    const clock = createTestClock();
    const routeSwitch = vi.spyOn(
      PulseAudioEngine.prototype,
      "routeSwitch",
    );
    vi.spyOn(performance, "now").mockImplementation(
      () => clock.scheduler.now(),
    );
    const { bridge } = createBridge();
    const controller = createBaseJamPulseController(
      { audioContext: null, chart },
      bridge,
      clock.scheduler,
    );
    controller.tap();

    for (const cue of chart.cues.slice(0, 2)) {
      clock.setNow((1.8 + cue.time) * 1_000);
      controller.route(controller.snapshot().expectedRoute ?? 0);
    }

    const switchCue = chart.cues[2];
    clock.setNow((1.8 + switchCue.time) * 1_000);
    const inputAt = clock.scheduler.now() - 18;
    controller.route(-1, inputAt);
    const snapshot = controller.snapshot();
    const feedback = snapshot.lastFeedback;

    expect(snapshot.state.activeFace).toBe(7);
    expect(snapshot.state.cueResults[switchCue.id]).toBe("perfect");
    expect(snapshot.state.score).toBeGreaterThan(0);
    expect(feedback).toMatchObject({
      route: -1,
      previousFace: 0,
      activeFace: 7,
      cueId: switchCue.id,
      outcome: "perfect",
      inputAtPerformanceMs: inputAt,
      receivedAtPerformanceMs: clock.scheduler.now(),
      publishedAtPerformanceMs: clock.scheduler.now(),
      settleDurationMs: BASE_JAM_PULSE_ROUTE_SETTLE_MS,
    });
    expect(
      (feedback?.publishedAtPerformanceMs ?? Infinity) -
        (feedback?.receivedAtPerformanceMs ?? 0),
    ).toBeLessThan(50);
    expect(routeSwitch).toHaveBeenCalledWith(-1, true);
    controller.destroy();
  });

  it("freezes and reanchors song time across focus pauses", () => {
    const clock = createTestClock();
    vi.spyOn(performance, "now").mockImplementation(
      () => clock.scheduler.now(),
    );
    const { bridge } = createBridge();
    const controller = createBaseJamPulseController(
      { audioContext: null, chart },
      bridge,
      clock.scheduler,
    );
    controller.tap();
    clock.setNow(1_000);
    expect(controller.snapshot().songTimeSeconds).toBeCloseTo(-0.8);

    controller.setFocused(false, "focus");
    const pausedAt = controller.snapshot().songTimeSeconds;
    clock.setNow(2_000);
    expect(controller.snapshot()).toMatchObject({
      phase: "paused",
      pauseReason: "focus",
      focused: false,
      songTimeSeconds: pausedAt,
    });

    controller.setFocused(true, "focus");
    clock.setNow(2_200);
    expect(controller.snapshot()).toMatchObject({
      phase: "preroll",
      pauseReason: null,
      focused: true,
    });
    expect(controller.snapshot().songTimeSeconds).toBeCloseTo(
      pausedAt + 0.2,
    );

    controller.setReducedMotion(true);
    expect(controller.snapshot().reducedMotion).toBe(true);
    controller.destroy();
  });
});
