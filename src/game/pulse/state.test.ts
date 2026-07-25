import { describe, expect, it } from "vitest";
import { createPracticeManifest } from "@/lib/base/manifest";
import { createPulseChart } from "./chart";
import {
  advancePulseState,
  createPulseState,
  finishPulseState,
  judgePulseRoute,
  judgePulseTap,
  pulseAccuracy,
  pulseComboMultiplier,
  pulseExpectedRoute,
  pulseFaceAfterRoute,
  pulseHitWindowForCue,
  pulseLayerForFace,
  PULSE_SYNC_BONUS_POINTS,
} from "./state";
import type { PulseCue, PulseRoute, PulseState } from "./types";

describe("pulse state", () => {
  const chart = createPulseChart(
    [createPracticeManifest({ reason: "test fixture" })],
    10,
  );

  function otherRoute(route: PulseRoute): PulseRoute {
    return route === 0 ? 1 : 0;
  }

  function hitCue(
    state: PulseState,
    cue: PulseCue,
    delta = 0,
  ): PulseState {
    return judgePulseRoute(
      chart,
      state,
      cue.time + delta,
      pulseExpectedRoute(cue, state),
    );
  }

  function stateAtEvent(
    eventIndex: number,
    overrides: Partial<PulseState> = {},
  ): PulseState {
    const cueResults = Object.fromEntries(
      chart.cues
        .filter((cue) => cue.eventIndex < eventIndex)
        .map((cue) => [cue.id, "miss" as const]),
    );
    const currentCue =
      chart.cues.find((cue) => cue.eventIndex === eventIndex)?.index ?? 0;
    return {
      ...createPulseState(),
      tutorialStep: 4,
      cueResults,
      currentCue,
      ...overrides,
    };
  }

  it("starts on the first face with an empty cue ledger", () => {
    const state = createPulseState();

    expect(state.activeFace).toBe(0);
    expect(state.currentCue).toBe(0);
    expect(state.channelCaptures).toEqual([0, 0, 0, 0]);
    expect(state.cueResults).toEqual({});
    expect(state.wrong).toBe(0);
    expect(state.misses).toBe(0);
    expect(state.tutorialStep).toBe(0);
  });

  it("wraps routes around eight physical faces and maps them to four layers", () => {
    expect(
      Array.from({ length: 8 }, (_, face) => pulseLayerForFace(face)),
    ).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(pulseLayerForFace(-1)).toBe(3);
    expect(pulseFaceAfterRoute(0, -1)).toBe(7);
    expect(pulseFaceAfterRoute(7, 1)).toBe(0);
    expect(pulseFaceAfterRoute(4, 0)).toBe(4);
  });

  it("teaches TAP, TAP, LEFT, RIGHT and repeats a command until success", () => {
    expect(pulseExpectedRoute(chart.cues[0], 0)).toBe(0);
    expect(pulseExpectedRoute(chart.cues[1], 1)).toBe(0);
    expect(pulseExpectedRoute(chart.cues[2], 2)).toBe(-1);
    expect(pulseExpectedRoute(chart.cues[3], 3)).toBe(1);

    let state = judgePulseRoute(
      chart,
      createPulseState(),
      chart.cues[0].time,
      1,
    );
    expect(state.tutorialStep).toBe(0);
    expect(state.cueResults[chart.cues[0].id]).toBe("wrong");

    state = hitCue(state, chart.cues[1]);
    expect(state.tutorialStep).toBe(1);
    expect(pulseExpectedRoute(chart.cues[2], state)).toBe(0);
  });

  it("advances all four tutorial commands only on successful cues", () => {
    let state = createPulseState();

    for (const cue of chart.cues.slice(0, 4)) {
      state = hitCue(state, cue);
    }

    expect(state.tutorialStep).toBe(4);
    expect(state.perfect).toBe(4);
    expect(state.wrong).toBe(0);
    expect(state.activeFace).toBe(0);
    expect(state.sealed).toBe(2);
  });

  it("cannot score an invisible cue before its actionable window", () => {
    const cue = chart.cues[0];
    expect(cue.time - pulseHitWindowForCue(cue, 0)).toBeGreaterThan(0);

    const state = judgePulseTap(chart, createPulseState(), 0);

    expect(state.score).toBe(0);
    expect(state.perfect).toBe(0);
    expect(state.cueResults).toEqual({});
  });

  it("records a wrong direction, consumes the cue, and breaks combo", () => {
    const cue = chart.cues[0];
    const initial = { ...createPulseState(), streak: 6 };
    const state = judgePulseRoute(
      chart,
      initial,
      cue.time,
      otherRoute(pulseExpectedRoute(cue, initial)),
    );

    expect(state.wrong).toBe(1);
    expect(state.streak).toBe(0);
    expect(state.score).toBe(0);
    expect(state.cueResults[cue.id]).toBe("wrong");
    expect(state.tutorialStep).toBe(0);
    expect(state.lastJudgement).toBeNull();
  });

  it("uses cue timing plus direction for perfect and good judgements", () => {
    let state = hitCue(createPulseState(), chart.cues[0]);
    state = hitCue(state, chart.cues[1], 0.18);

    expect(state.perfect).toBe(1);
    expect(state.good).toBe(1);
    expect(state.cueResults[chart.cues[0].id]).toBe("perfect");
    expect(state.cueResults[chart.cues[1].id]).toBe("good");
    expect(state.sealed).toBe(1);
    expect(state.eventResults[chart.events[0].id]).toBe("good");
  });

  it("uses tap as an exact route-zero compatibility alias", () => {
    const initial = createPulseState();
    const time = chart.cues[0].time;

    expect(judgePulseTap(chart, initial, time)).toEqual(
      judgePulseRoute(chart, initial, time, 0),
    );
  });

  it("rotates outside a timing window without awarding or consuming a cue", () => {
    const state = judgePulseRoute(chart, createPulseState(), 0, 1);

    expect(state.activeFace).toBe(1);
    expect(state.lastRoute).toBe(1);
    expect(state.lastRoutedLayer).toBeNull();
    expect(state.cueResults).toEqual({});
    expect(state.score).toBe(0);
  });

  it("applies a x1–x4 score multiplier as combo grows", () => {
    expect([0, 1, 4, 5, 9, 10, 19, 20, 99].map(pulseComboMultiplier)).toEqual([
      1, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);

    const cue = chart.cues[0];
    const state = hitCue(
      { ...createPulseState(), streak: 19, tutorialStep: 4 },
      cue,
    );
    const routedLayer = pulseLayerForFace(state.activeFace);
    const sync =
      routedLayer === chart.events[cue.eventIndex].signalLayer
        ? PULSE_SYNC_BONUS_POINTS
        : 0;

    expect(state.score).toBe(400 + sync);
    expect(state.streak).toBe(20);
  });

  it("seals a four-cue phrase at the 75% hit threshold", () => {
    const event = chart.events[7];
    const cues = chart.cues.filter((cue) => cue.eventIndex === event.index);
    let state = stateAtEvent(event.index);

    for (const cue of cues.slice(0, 3)) state = hitCue(state, cue);
    const last = cues[3];
    state = judgePulseRoute(
      chart,
      state,
      last.time,
      otherRoute(last.route),
    );

    expect(state.sealed).toBe(1);
    expect(state.flows).toBe(0);
    expect(state.eventResults[event.id]).toBe("good");
    expect(state.channelCaptures[event.signalLayer]).toBe(1);
    expect(state.capturedUntilBar[event.signalLayer]).toBe(event.index + 3);
  });

  it("flows a failed phrase and expires its signal stem", () => {
    const event = chart.events[7];
    const cues = chart.cues.filter((cue) => cue.eventIndex === event.index);
    let state = stateAtEvent(event.index, {
      capturedUntilBar: [20, 20, 20, 20] as const,
    });

    for (const cue of cues.slice(0, 2)) state = hitCue(state, cue);
    for (const cue of cues.slice(2)) {
      state = judgePulseRoute(
        chart,
        state,
        cue.time,
        otherRoute(cue.route),
      );
    }

    expect(state.sealed).toBe(0);
    expect(state.flows).toBe(1);
    expect(state.eventResults[event.id]).toBe("flow");
    expect(state.capturedUntilBar[event.signalLayer]).toBe(event.index);
  });

  it("expires unresolved cues as misses and fails their completed phrase", () => {
    const lastCue = chart.cues[1];
    const state = advancePulseState(
      chart,
      { ...createPulseState(), streak: 4 },
      lastCue.time + pulseHitWindowForCue(lastCue, 0) + 0.01,
    );

    expect(state.misses).toBe(2);
    expect(state.streak).toBe(0);
    expect(state.cueResults[chart.cues[0].id]).toBe("miss");
    expect(state.cueResults[lastCue.id]).toBe("miss");
    expect(state.flows).toBe(1);
    expect(state.eventResults[chart.events[0].id]).toBe("flow");
  });

  it("computes accuracy from every judged cue, including wrongs and misses", () => {
    const state = {
      ...createPulseState(),
      perfect: 2,
      good: 1,
      wrong: 1,
      misses: 1,
    };

    expect(pulseAccuracy(state)).toBe(54);
  });

  it("finishes every remaining cue and phrase honestly", () => {
    const state = finishPulseState(chart, createPulseState());

    expect(state.finished).toBe(true);
    expect(state.misses).toBe(chart.cues.length);
    expect(Object.keys(state.cueResults)).toHaveLength(chart.cues.length);
    expect(state.flows).toBe(chart.events.length);
    expect(state.sealed).toBe(0);
    expect(pulseAccuracy(state)).toBe(0);
  });
});
