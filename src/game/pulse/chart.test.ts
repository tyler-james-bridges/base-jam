import { describe, expect, it } from "vitest";
import { createPracticeManifest } from "@/lib/base/manifest";
import { createPulseChart, pulseCueCountForEvent } from "./chart";

describe("createPulseChart", () => {
  it("turns ten Base blocks into a deterministic 31-cue phrase chart", () => {
    const level = createPracticeManifest({ reason: "test fixture" });
    const first = createPulseChart([level]);
    const second = createPulseChart([level]);

    expect(first).toEqual(second);
    expect(first.version).toBe("base-jam-pulse-v2");
    expect(first.durationSeconds).toBe(20);
    expect(first.events).toHaveLength(10);
    expect(first.cues).toHaveLength(31);
    expect(
      first.events.map(
        (event) =>
          first.cues.filter((cue) => cue.eventIndex === event.index).length,
      ),
    ).toEqual([2, 2, 3, 3, 3, 3, 3, 4, 4, 4]);
  });

  it("keeps every cue ordered, bounded inside its phrase, and playable", () => {
    const chart = createPulseChart(
      [createPracticeManifest({ reason: "test fixture" })],
      10,
    );

    chart.cues.forEach((cue, index) => {
      const event = chart.events[cue.eventIndex];
      expect(cue.index).toBe(index);
      expect(cue.phraseIndex).toBeLessThan(
        pulseCueCountForEvent(cue.eventIndex),
      );
      expect(cue.time).toBeGreaterThan(event.time);
      expect(cue.time).toBeLessThan(event.time + chart.secondsPerBlock);
      expect([-1, 0, 1]).toContain(cue.route);
      expect([0, 1, 2]).toContain(cue.lane);
      expect(cue.energy).toBeGreaterThanOrEqual(0.35);
      expect(cue.energy).toBeLessThanOrEqual(1);
      if (index > 0) expect(cue.time).toBeGreaterThan(chart.cues[index - 1].time);
    });
  });

  it("scales cue density by block index", () => {
    expect(
      Array.from({ length: 10 }, (_, index) =>
        pulseCueCountForEvent(index),
      ),
    ).toEqual([2, 2, 3, 3, 3, 3, 3, 4, 4, 4]);
  });

  it("rejects empty and overlong sessions", () => {
    expect(() => createPulseChart([])).toThrow(/at least one/i);
    expect(() =>
      createPulseChart(
        [createPracticeManifest({ reason: "test fixture" })],
        11,
      ),
    ).toThrow(/between 1 and 10/i);
  });
});
