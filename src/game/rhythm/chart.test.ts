import { describe, expect, it } from "vitest";
import { createPracticeManifest } from "@/lib/base/manifest";
import { createRhythmChart } from "./chart";

describe("createRhythmChart", () => {
  it("turns Base data into a deterministic, balanced four-rail chart", () => {
    const level = createPracticeManifest({ reason: "test fixture" });
    const first = createRhythmChart([level], 3);
    const second = createRhythmChart([level], 3);

    expect(first).toEqual(second);
    expect(first.durationSeconds).toBe(6);
    expect(first.bars).toHaveLength(3);
    expect(first.notes).toHaveLength(36);

    for (let bar = 0; bar < 3; bar += 1) {
      for (let lane = 0; lane < 4; lane += 1) {
        expect(
          first.notes.filter(
            (note) => note.bar === bar && note.lane === lane,
          ),
        ).toHaveLength(3);
      }
    }
  });

  it("rejects empty and overlong mixes", () => {
    expect(() => createRhythmChart([])).toThrow(/at least one/i);
    expect(() =>
      createRhythmChart(
        [createPracticeManifest({ reason: "test fixture" })],
        16,
      ),
    ).toThrow(/between 1 and 15/i);
  });
});
