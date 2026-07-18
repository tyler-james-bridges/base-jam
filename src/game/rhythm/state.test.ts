import { describe, expect, it } from "vitest";
import { createPracticeManifest } from "@/lib/base/manifest";
import { createRhythmChart } from "./chart";
import {
  advanceRhythmState,
  createRhythmState,
  judgeRhythmHit,
  rhythmAccuracy,
} from "./state";

describe("rhythm state", () => {
  it("captures a stem after a complete three-note phrase", () => {
    const chart = createRhythmChart(
      [createPracticeManifest({ reason: "test fixture" })],
      2,
    );
    const phrase = chart.notes
      .filter((note) => note.bar === 0 && note.lane === 0)
      .sort((left, right) => left.time - right.time);
    let state = createRhythmState();

    phrase.forEach((note) => {
      state = judgeRhythmHit(chart, state, note.column, note.time);
    });

    expect(state.perfect).toBe(3);
    expect(state.captures).toBe(1);
    expect(state.capturedUntilBar[0]).toBe(4);
    expect(state.score).toBe(800);
    expect(rhythmAccuracy(state)).toBe(100);
  });

  it("marks only the engaged rail's expired notes as misses", () => {
    const chart = createRhythmChart(
      [createPracticeManifest({ reason: "test fixture" })],
      2,
    );
    const state = advanceRhythmState(chart, createRhythmState(), 1.9);

    expect(state.misses).toBe(3);
    expect(
      chart.notes
        .filter((note) => note.bar === 0 && note.lane !== 0)
        .some((note) => state.noteResults[note.id]),
    ).toBe(false);
  });
});
